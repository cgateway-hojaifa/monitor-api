import type { ExpectedHeader } from "@/entities/Project";

/**
 * Validation for a project's payment-page settings (PCI DSS 11.6.1). Both return a value ready to
 * store, or a user-facing message. Used by project create/update.
 */
export type ConfigResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * The scanner points a headless browser at this URL, so only http/https are accepted — schemes
 * such as file:// or javascript: must never reach puppeteer's goto(). Empty → null (monitoring off).
 */
export function normalizePageUrl(raw: unknown): ConfigResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "Page URL must be a string." };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, message: "Page URL is not a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return { ok: false, message: "Page URL must use http:// or https://." };
  if (trimmed.length > 2048)
    return { ok: false, message: "Page URL is too long (max 2048 characters)." };

  return { ok: true, value: parsed.toString() };
}

// RFC 7230 header field-name token.
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** `[{name, value}]` → stored JSON (names lowercased). Fully blank rows are skipped. */
export function normalizeExpectedHeaders(raw: unknown): ConfigResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false, message: "Headers must be a list." };

  const seen = new Set<string>();
  const cleaned: ExpectedHeader[] = [];

  for (const item of raw) {
    const name = String(item?.name ?? "")
      .trim()
      .toLowerCase();
    const value = String(item?.value ?? "").trim();

    if (name === "" && value === "") continue;
    if (name === "") return { ok: false, message: "Header name is required." };
    if (!HEADER_NAME_RE.test(name))
      return { ok: false, message: `Invalid header name: "${name}".` };
    if (name.length > 190) return { ok: false, message: `Header name too long: "${name}".` };
    if (value === "") return { ok: false, message: `Expected value is required for "${name}".` };
    if (value.length > 4096)
      return { ok: false, message: `Expected value too long for "${name}".` };
    if (seen.has(name)) return { ok: false, message: `Duplicate header: "${name}".` };

    seen.add(name);
    cleaned.push({ name, value });
  }

  return { ok: true, value: cleaned.length > 0 ? JSON.stringify(cleaned) : null };
}

/** A file's URL: required, http/https only (the server fetches it and the UI links to it). */
export function normalizeFileUrl(raw: unknown): ConfigResult {
  const res = normalizePageUrl(raw);
  if (res.ok && res.value === null) return { ok: false, message: "File URL is required." };
  if (!res.ok) return { ok: false, message: res.message.replace("Page URL", "File URL") };
  return res;
}
