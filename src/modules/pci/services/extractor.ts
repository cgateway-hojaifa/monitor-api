export interface ExtractedValue {
  key: string;
  value: string;
  type: "string" | "number" | "boolean" | "null" | "html";
  raw: string;
  source: "js" | "html";
}

export interface ComparisonResult {
  matched: Array<{ key: string; value: string }>;
  mismatched: Array<{
    key: string;
    localValue: string;
    remoteValue: string;
    localRaw: string;
    remoteRaw: string;
  }>;
  onlyInLocal: Array<{ key: string; value: string; raw: string }>;
  onlyInRemote: Array<{ key: string; value: string; raw: string }>;
  totalLocal: number;
  totalRemote: number;
  contentType: "html" | "js" | "mixed";
}

export interface RawComparisonResult {
  isIdentical: boolean;
  localLength: number;
  remoteLength: number;
  localHash: string;
  remoteHash: string;
}

function unquote(r: string) {
  return r.replace(/^["'`]|["'`]$/g, "");
}
function inferType(r: string): ExtractedValue["type"] {
  if (r === "null") return "null";
  if (r === "true" || r === "false") return "boolean";
  if (/^-?\d/.test(r)) return "number";
  return "string";
}
function coerce(r: string) {
  return inferType(r) === "string" ? unquote(r) : r;
}
function stripComments(s: string) {
  s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
  return s.replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

const STR = `(?:"[^"\\\\]*(?:\\\\.[^"\\\\]*)*"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*'|\`[^\`\\\\]*(?:\\\\.[^\`\\\\]*)*\`)`;
const NUM = `-?\\d+(?:\\.\\d+)?`;
const VAL = `(?:${STR}|${NUM}|true|false|null)`;
const SKIP = new Set([
  "return",
  "case",
  "default",
  "break",
  "continue",
  "typeof",
  "instanceof",
  "void",
  "delete",
  "throw",
  "new",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "catch",
  "finally",
  "import",
  "export",
  "function",
  "class",
  "extends",
  "super",
  "this",
  "yield",
  "await",
  "const",
  "let",
  "var",
  "do",
  "in",
  "of",
]);

export function detectContentType(src: string): "html" | "js" | "mixed" {
  const hasHTML = /<[a-zA-Z][^>]*>[\s\S]*?<\/[a-zA-Z]>/m.test(src);
  const hasJS =
    /(?:const|let|var|function|\$[\.(])\s/.test(src) ||
    /[A-Za-z_$][A-Za-z0-9_$]*\s*[=:]\s*["'`\d]/.test(src);
  if (hasHTML && hasJS) return "mixed";
  if (hasHTML) return "html";
  return "js";
}

export function extractValuesFromJS(source: string): Record<string, ExtractedValue> {
  const out: Record<string, ExtractedValue> = {};
  const src = stripComments(source);
  function put(key: string, raw: string, s: "js" | "html" = "js") {
    if (SKIP.has(key) || key in out) return;
    out[key] = { key, raw, value: coerce(raw), type: inferType(raw), source: s };
  }
  function putH(key: string, value: string, raw: string) {
    if (key in out) return;
    out[key] = { key, value, raw, type: "html", source: "js" };
  }
  for (const m of src.matchAll(
    new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(${VAL})`, "g"),
  ))
    put(m[1], m[2]);
  for (const m of src.matchAll(
    new RegExp(`(?:^|[,{\\n;])\\s*([A-Za-z_$][A-Za-z0-9_$]*)\\s*:\\s*(${VAL})`, "gm"),
  ))
    put(m[1], m[2]);
  for (const m of src.matchAll(
    new RegExp(`(?<![:.\\[])\\b([A-Za-z_$][A-Za-z0-9_$]*)\\s*=\\s*(${VAL})(?!\\s*[:(])`, "g"),
  ))
    put(m[1], m[2]);
  for (const bm of src.matchAll(
    /\$\.(?:ajax|get|post|getJSON|getScript|put|delete|patch)\s*\(\s*(\{[\s\S]*?\})/g,
  ))
    for (const m of bm[1].matchAll(new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\s*:\\s*(${VAL})`, "g")))
      put(`ajax.${m[1]}`, m[2]);
  for (const m of src.matchAll(
    new RegExp(`\\.data\\s*\\(\\s*(${STR})\\s*,\\s*(${VAL})\\s*\\)`, "g"),
  ))
    put(`data.${unquote(m[1])}`, m[2]);
  for (const m of src.matchAll(
    new RegExp(`\\.(?:attr|prop)\\s*\\(\\s*(${STR})\\s*,\\s*(${VAL})\\s*\\)`, "g"),
  ))
    put(`attr.${unquote(m[1])}`, m[2]);
  for (const m of src.matchAll(
    /\.(?:append|prepend|html|after|before)\s*\(\s*(['"`])([\s\S]*?)\1\s*\)/g,
  ))
    for (const om of m[2].matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/gi))
      putH(`option[${om[1]}]`, om[2].trim(), om[0].trim());
  for (const m of src.matchAll(
    /new\s+Option\s*\(\s*['"`]([^'"`]*)['"`]\s*,\s*['"`]([^'"`]*)['"`]\s*\)/g,
  ))
    putH(`option[${m[2]}]`, m[1], m[0].trim());
  for (const bm of src.matchAll(/\$\.each\s*\(\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*,\s*function/g))
    for (const pair of bm[1].matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g))
      putH(`option[${pair[1]}]`, pair[2], pair[0].trim());
  return out;
}

export function extractValuesFromHTML(source: string): Record<string, ExtractedValue> {
  const out: Record<string, ExtractedValue> = {};
  function put(key: string, value: string, raw: string) {
    if (key in out) return;
    out[key] = { key, value, raw, type: "html", source: "html" };
  }
  for (const sm of source.matchAll(
    /<select[^>]*(?:name=["']([^"']*)["']|id=["']([^"']*)["'])[^>]*>([\s\S]*?)<\/select>/gi,
  )) {
    const sid = (sm[1] || sm[2] || "select").replace(/\s+/g, "_");
    for (const om of sm[3].matchAll(
      /<option(?:[^>]*value=["']([^"']*)["'][^>]*)?>([^<]*)<\/option>/gi,
    ))
      put(`select.${sid}.option[${om[1] ?? ""}]`, om[2].trim(), om[0].trim());
  }
  for (const om of source.matchAll(
    /<option(?:[^>]*value=["']([^"']*)["'][^>]*)?>([^<]*)<\/option>/gi,
  ))
    put(`option[${om[1] ?? ""}]`, om[2].trim(), om[0].trim());
  for (const m of source.matchAll(/<input([^>]*)>/gi)) {
    const a = m[1];
    const name = (a.match(/name=["']([^"']*)["']/i) ?? a.match(/id=["']([^"']*)["']/i))?.[1];
    if (!name) continue;
    const type = a.match(/type=["']([^"']*)["']/i)?.[1]?.toLowerCase() ?? "text";
    const val = a.match(/value=["']([^"']*)["']/i)?.[1] ?? "";
    put(`input.${type}.${name}`, val, m[0].trim());
  }
  for (const m of source.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name=["']([^"']*)["']/i) ?? m[1].match(/id=["']([^"']*)["']/i))?.[1];
    if (name) put(`textarea.${name}`, m[2].trim(), m[0].trim());
  }
  return out;
}

export function extractValues(source: string): Record<string, ExtractedValue> {
  const type = detectContentType(source);
  if (type === "html") return extractValuesFromHTML(source);
  if (type === "js") return extractValuesFromJS(source);
  return { ...extractValuesFromJS(source), ...extractValuesFromHTML(source) };
}

export function compareValues(
  local: Record<string, ExtractedValue>,
  remote: Record<string, ExtractedValue>,
): ComparisonResult {
  const matched: ComparisonResult["matched"] = [];
  const mismatched: ComparisonResult["mismatched"] = [];
  const onlyInLocal: ComparisonResult["onlyInLocal"] = [];
  const onlyInRemote: ComparisonResult["onlyInRemote"] = [];

  const normalize = (s: string) => {
    try {
      return decodeURIComponent(escape(s));
    } catch {
      return s;
    }
  };

  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key],
      r = remote[key];
    if (l && r) {
      const lv = normalize(l.value),
        rv = normalize(r.value);
      if (lv === rv) matched.push({ key, value: rv });
      else
        mismatched.push({
          key,
          localValue: lv,
          remoteValue: rv,
          localRaw: l.raw,
          remoteRaw: r.raw,
        });
    } else if (l) onlyInLocal.push({ key, value: normalize(l.value), raw: l.raw });
    else onlyInRemote.push({ key, value: normalize(r!.value), raw: r!.raw });
  }

  const all = [...Object.values(local), ...Object.values(remote)];
  const hasHTML = all.some((v) => v.source === "html"),
    hasJS = all.some((v) => v.source === "js");
  return {
    matched,
    mismatched,
    onlyInLocal,
    onlyInRemote,
    totalLocal: Object.keys(local).length,
    totalRemote: Object.keys(remote).length,
    contentType: hasHTML && hasJS ? "mixed" : hasHTML ? "html" : "js",
  };
}

// ─── Raw / hash-based comparison ─────────────────────────────────────────────

function simpleHash(str: string): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  return hex.padStart(16, "0");
}

export function normalizeContent(src: string): string {
  let s = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  // Fix UTF-8 double-encoding: Â© → ©  (bytes stored as Latin-1 then re-read)
  try {
    const f = decodeURIComponent(escape(s));
    if (f !== s) s = f;
  } catch {
    /* keep original */
  }
  return s;
}

export function compareRaw(local: string, remote: string): RawComparisonResult {
  const l = normalizeContent(local);
  const r = normalizeContent(remote);
  return {
    isIdentical: l === r,
    localLength: l.length,
    remoteLength: r.length,
    localHash: simpleHash(l),
    remoteHash: simpleHash(r),
  };
}
