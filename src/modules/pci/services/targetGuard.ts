import dns from "dns/promises";
import net from "net";

/**
 * Outbound-request guard for the PCI checks. File checks fetch admin-supplied URLs server-side and
 * page scans point a browser at them, so before any request:
 *  - only http/https is allowed;
 *  - the host must resolve to public addresses — loopback, private, link-local (incl. cloud
 *    metadata 169.254.169.254), CGNAT, multicast and reserved ranges are refused.
 * `PCI_ALLOW_PRIVATE_TARGETS=true` lifts the address check (e.g. a dev box checking localhost).
 *
 * Limitation: the address is checked at lookup time; a host that re-resolves differently a moment
 * later (DNS rebinding) is not caught. Redirects are re-checked hop by hop in `fetchChecked`.
 */

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOCKED.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  BLOCKED.addSubnet(addr, prefix, "ipv6");

export class TargetError extends Error {}

function isBlocked(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as the IPv4 it carries.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return BLOCKED.check(mapped[1], "ipv4");
  return BLOCKED.check(address, family === 6 ? "ipv6" : "ipv4");
}

/** Throw a TargetError unless `rawUrl` is http(s) and its host resolves only to public addresses. */
export async function assertPublicTarget(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TargetError("Invalid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TargetError("Only http:// and https:// URLs can be checked.");
  if (process.env.PCI_ALLOW_PRIVATE_TARGETS === "true") return url;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = net.isIP(host)
      ? [host]
      : (await dns.lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new TargetError(`Host not found (DNS): ${host}`);
  }
  if (addresses.length === 0 || addresses.some(isBlocked))
    throw new TargetError(`Refused: ${host} resolves to a private or reserved address.`);
  return url;
}

const MAX_REDIRECTS = 5;

/**
 * `fetch` with the guard applied to the URL and to every redirect hop, and the body capped at
 * `maxBytes` (read as a stream, so an oversized response is cut off, not buffered whole).
 */
export async function fetchChecked(
  rawUrl: string,
  init: RequestInit,
  maxBytes: number,
): Promise<{ status: number; statusText: string; ok: boolean; body: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicTarget(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }

    const declared = Number(res.headers.get("content-length"));
    if (declared > maxBytes) throw new TargetError(`Response too large (${declared} bytes).`);

    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new TargetError(`Response too large (over ${maxBytes} bytes).`);
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return { status: res.status, statusText: res.statusText, ok: res.ok, body };
  }
  throw new TargetError(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

/** Run `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
