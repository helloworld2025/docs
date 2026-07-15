// 极简 Cookie 解析/序列化工具（避免引入额外依赖）。
export const SESSION_COOKIE = "doc_session";

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSec?: number; path?: string } = {}
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${opts.maxAgeSec}`);
  parts.push("HttpOnly");
  parts.push("Secure");
  parts.push("SameSite=Lax");
  return parts.join("; ");
}

export function clearCookie(name: string, path = "/"): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
