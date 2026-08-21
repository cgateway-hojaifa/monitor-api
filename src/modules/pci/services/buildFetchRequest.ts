export function buildFetchRequest(rawUrl: string): { url: string; options: RequestInit } {
  let cacheBustedUrl: string;

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("_", Date.now().toString());
    cacheBustedUrl = url.toString();
  } catch {
    const sep = rawUrl.includes("?") ? "&" : "?";
    cacheBustedUrl = `${rawUrl}${sep}_=${Date.now()}`;
  }

  return {
    url: cacheBustedUrl,
    options: {
      headers: {
        "User-Agent": "FileValidator/1.0",
        "Cache-Control": "no-cache, no-store",
        Pragma: "no-cache",
      },
      signal: AbortSignal.timeout(10000),
    },
  };
}
