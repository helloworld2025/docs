// POST /api/auth/login —— 邮箱+密码 + Turnstile 校验 → 签发 JWT，写入 httpOnly Cookie。
// 逻辑对齐 relay-server 的 routes/admin_auth.rs::login。
import type { Env } from "../../../shared/env";
import { verifyPassword } from "../../../shared/crypto";
import { signAdminJwt } from "../../../shared/jwt";
import { verifyTurnstile } from "../../../shared/turnstile";
import { serializeCookie, SESSION_COOKIE } from "../../../shared/cookie";

const JWT_TTL_SEC = 86_400; // 24 小时

interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    cf_turnstile_response?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return jsonError(400, "INVALID_REQUEST", "email and password are required");
  }

  const turnstileOk = await verifyTurnstile(body.cf_turnstile_response || "", env.TURNSTILE_SECRET);
  if (!turnstileOk) {
    return jsonError(400, "TURNSTILE_FAILED", "Human verification failed. Please try again.");
  }

  const row = await env.DB.prepare(
    "SELECT id, email, password_hash, role FROM admin_users WHERE email = ?"
  )
    .bind(email)
    .first<AdminRow>();

  if (!row) {
    return jsonError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const passwordOk = await verifyPassword(password, row.password_hash);
  if (!passwordOk) {
    return jsonError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const token = await signAdminJwt(
    { sub: row.id, email: row.email, role: row.role },
    env.ADMIN_JWT_SECRET,
    JWT_TTL_SEC
  );

  return new Response(
    JSON.stringify({
      success: true,
      data: { admin: { id: row.id, email: row.email, role: row.role }, expires_in: JWT_TTL_SEC },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": serializeCookie(SESSION_COOKIE, token, { maxAgeSec: JWT_TTL_SEC }),
      },
    }
  );
};

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
