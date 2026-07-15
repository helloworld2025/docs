// Cloudflare Turnstile 服务端校验，逻辑对齐 relay-server 的 admin_auth.rs::verify_turnstile。
export async function verifyTurnstile(token: string, secret: string): Promise<boolean> {
  // 未配置 secret（本地开发）时直接放行。
  if (!secret) return true;
  if (!token) return false;

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    const data = (await res.json()) as { success: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}
