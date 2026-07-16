// 全站鉴权网关：除公开路径外，所有请求都必须携带合法的 doc_session JWT Cookie。
// 未登录：页面导航请求 → 302 重定向到 /login；API 请求 → 401 JSON。
//
// 注意：VitePress 构建时开启了 cleanUrls（见 .vitepress/config.ts），Cloudflare Pages
// 静态资源层会把 /login.html 请求以 308 重定向到 /login，这个重定向发生在本
// middleware 之后（asset serving 阶段）。所以这里必须把 "/login"（不带 .html）
// 也加入白名单，否则会出现 "/login.html" → 308 "/login" → middleware 未放行
// → 302 "/login.html" 的死循环。
import type { Env } from "../shared/env";
import { verifyAdminJwt } from "../shared/jwt";
import { parseCookies, SESSION_COOKIE } from "../shared/cookie";

const PUBLIC_PATH_PREFIXES = [

  "/login.html",
  "/login",
  "/api/auth/login",
  "/api/auth/refresh",
  "/api/config",
];


// 静态资源后缀直接放行（VitePress 构建产物里的 css/js/图片/字体等）
const STATIC_EXT_RE = /\.(css|js|mjs|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|map|json)$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true;
  if (STATIC_EXT_RE.test(pathname)) return true;
  return false;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const url = new URL(request.url);

  if (isPublicPath(url.pathname)) {
    return next();
  }

  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  const claims = token ? await verifyAdminJwt(token, env.ADMIN_JWT_SECRET) : null;

  if (!claims) {
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Login required" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const redirectTo = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(new URL(`/login.html?redirect=${redirectTo}`, url.origin).toString(), 302);
  }

  return next();
};
