// POST /api/auth/refresh —— 用当前有效 Cookie 换发新 JWT，延长会话。
import type { Env } from "../../../shared/env";
import { verifyAdminJwt, signAdminJwt } from "../../../shared/jwt";
import { parseCookies, serializeCookie, SESSION_COOKIE } from "../../../shared/cookie";

const JWT_TTL_SEC = 86_400;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return unauthorized();

  const claims = await verifyAdminJwt(token, env.ADMIN_JWT_SECRET);
  if (!claims) return unauthorized();

  const newToken = await signAdminJwt(
    { sub: claims.sub, email: claims.email, role: claims.role },
    env.ADMIN_JWT_SECRET,
    JWT_TTL_SEC
  );

  return new Response(JSON.stringify({ success: true, data: { expires_in: JWT_TTL_SEC } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": serializeCookie(SESSION_COOKIE, newToken, { maxAgeSec: JWT_TTL_SEC }),
    },
  });
};

function unauthorized(): Response {
  return new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid or expired session" } }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
