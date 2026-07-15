// POST /api/auth/logout —— 无状态设计，仅清除 Cookie（与 relay-server 保持一致的取舍）。
import type { Env } from "../../../shared/env";
import { clearCookie, SESSION_COOKIE } from "../../../shared/cookie";

export const onRequestPost: PagesFunction<Env> = async () => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookie(SESSION_COOKIE),
    },
  });
};
