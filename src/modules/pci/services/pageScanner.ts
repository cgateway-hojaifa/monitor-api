import { launchBrowser } from "@/modules/pci/services/browser";
import { assertPublicTarget } from "@/modules/pci/services/targetGuard";
import logger from "@/config/logger";

/**
 * Payment page scanner — PCI DSS 11.6.1.
 *
 * Loads the page in a real headless browser and records the HTTP response headers exactly as the
 * consumer browser receives them. Only the main document's headers are captured: the script
 * inventory check of the original app is switched off (third-party script URLs carry cache-busting
 * values that change on every load and raised false alerts).
 */

export interface PageSnapshot {
  capturedAt: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  headers: Record<string, string>;
}

/** Headers that change on every response — dropped so they can never be checked and always alert. */
const VOLATILE_HEADERS = new Set([
  "date",
  "age",
  "expires",
  "last-modified",
  "etag",
  "set-cookie",
  "content-length",
  "keep-alive",
  "connection",
  "cf-ray",
  "x-request-id",
  "x-amz-cf-id",
  "x-amz-request-id",
  "request-id",
  "traceparent",
  "report-to",
  "nel",
  "server-timing",
  "x-served-by",
  "x-cache",
  "x-cache-hits",
  "x-timer",
]);

const NAV_TIMEOUT_MS = 60_000;

/**
 * A header sent more than once arrives joined by newlines. Identical repeats collapse to one value
 * (otherwise "SAMEORIGIN\nSAMEORIGIN" never matches "SAMEORIGIN"); genuinely different values are
 * kept, comma-joined, so the mismatch still shows.
 */
function normalizeHeaderValue(raw: string): string {
  const parts = raw
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return raw.trim();
  const unique = Array.from(new Set(parts));
  return unique.length === 1 ? unique[0] : unique.join(", ");
}

export async function scanPage(pageUrl: string): Promise<PageSnapshot> {
  // Refuse a private/reserved target before a browser is even started.
  await assertPublicTarget(pageUrl);

  const browser = await launchBrowser({ width: 1366, height: 900 });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache, no-store", Pragma: "no-cache" });

    // Re-check every main-frame navigation (redirects included) against the same guard, so a
    // public URL cannot redirect the browser into the internal network. Sub-resources pass through.
    let refused: string | null = null;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) {
        req.continue().catch(() => {});
        return;
      }
      assertPublicTarget(req.url())
        .then(() => req.continue())
        .catch((err: Error) => {
          refused = err.message;
          return req.abort("accessdenied");
        })
        .catch(() => {});
    });

    let headers: Record<string, string> = {};
    let finalUrl = pageUrl;
    let httpStatus = 0;

    // The main frame's navigation response — the last one wins, so redirects end on the final page.
    page.on("response", (response) => {
      try {
        const req = response.request();
        if (
          req.resourceType() === "document" &&
          req.isNavigationRequest() &&
          req.frame() === page.mainFrame()
        ) {
          headers = response.headers();
          finalUrl = response.url();
          httpStatus = response.status();
        }
      } catch {
        /* ignore individual response failures */
      }
    });

    // Headers arrive with the first response; no need to wait for the page's scripts.
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    } catch (err) {
      throw refused ? new Error(refused) : err;
    }

    const filtered: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (!VOLATILE_HEADERS.has(key)) filtered[key] = normalizeHeaderValue(value);
    }

    logger.debug(
      `[PageScan] ${pageUrl} → HTTP ${httpStatus}` +
        (finalUrl !== pageUrl ? ` (redirected to ${finalUrl})` : "") +
        ` · ${Object.keys(filtered).length} header(s)`,
    );

    return {
      capturedAt: new Date().toISOString(),
      requestedUrl: pageUrl,
      finalUrl,
      httpStatus,
      headers: filtered,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
