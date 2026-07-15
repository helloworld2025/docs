// 公开端点：返回前端登录页需要的 Turnstile site key（非敏感信息）。
import type { Env } from "../../shared/env";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return Response.json({
    turnstile_site_key: env.TURNSTILE_SITE_KEY || "",
  });
};
