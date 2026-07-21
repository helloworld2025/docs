// GET/PUT/DELETE /api/file?section=<key>&path=<relative path> —— 读取/保存/删除源仓库中的 Markdown 文件。
// section 分两类（见 shared/sections.ts）：
//   - 同步类（account/relay/analytics）：按 SOURCE_REPOS 里配置的 key 解析到对应源仓库
//   - 自定义分类（general 及网页端新建的任意分类名）：统一解析到 docs 仓库自身
//     （即 SOURCE_REPOS.general 配置的仓库），因此可以任意新建/删除，无需逐一在
//     wrangler.toml 里配置。
// PUT 同时承担"新建"（sha 不传）和"更新"（sha 必传）两种语义，与 GitHub Contents API 一致。
//
// 冲突处理：PUT/DELETE 请求体需带上 GET 时返回的 sha；GitHub 若检测到文件已被他人
// 修改会返回 409，这里原样透传给前端，由前端提示用户刷新重新编辑（不做静默覆盖）。
import type { Env } from "../../shared/env";
import { sourceRepos } from "../../shared/env";
import { getFile, putFile, deleteFile, GithubApiError } from "../../shared/github";
import { verifyAdminJwt } from "../../shared/jwt";
import { parseCookies, SESSION_COOKIE } from "../../shared/cookie";
import { isSyncedSection } from "../../shared/sections";


function resolveRepo(env: Env, section: string): string | null {
  const repos = sourceRepos(env);
  if (isSyncedSection(section)) return repos[section] || null;
  // 自定义分类统一落在 docs 仓库自身（SOURCE_REPOS.general 配置的仓库）。
  return repos["general"] || null;
}


function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ success: false, error: { code, message } }, { status });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const section = url.searchParams.get("section") || "";
  const path = url.searchParams.get("path") || "";
  if (!section || !path) return jsonError(400, "INVALID_REQUEST", "section and path are required");

  const repo = resolveRepo(env, section);
  if (!repo) return jsonError(404, "UNKNOWN_SECTION", `Unknown section: ${section}`);

  try {
    const file = await getFile(repo, path, env.GITHUB_TOKEN);
    return Response.json({ success: true, data: { content: file.content, sha: file.sha, repo, path } });
  } catch (e) {
    if (e instanceof GithubApiError) return jsonError(e.status, "GITHUB_ERROR", e.message);
    return jsonError(500, "UNKNOWN_ERROR", String(e));
  }
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  const claims = token ? await verifyAdminJwt(token, env.ADMIN_JWT_SECRET) : null;
  if (!claims) return jsonError(401, "UNAUTHORIZED", "Login required");

  const body = (await request.json().catch(() => ({}))) as {
    section?: string;
    path?: string;
    content?: string;
    sha?: string;
    message?: string;
  };
  const { section, path, content, sha } = body;
  if (!section || !path || content === undefined) {
    return jsonError(400, "INVALID_REQUEST", "section, path and content are required");
  }

  const repo = resolveRepo(env, section);
  if (!repo) return jsonError(404, "UNKNOWN_SECTION", `Unknown section: ${section}`);

  try {
    const result = await putFile({
      repo,
      path,
      content,
      sha,
      message: body.message || `docs: update ${path} via doc editor`,
      authorName: claims.email,
      authorEmail: claims.email,
      token: env.GITHUB_TOKEN,
    });
    return Response.json({ success: true, data: { sha: result.sha } });
  } catch (e) {
    if (e instanceof GithubApiError) {
      // 409 = 编辑冲突（sha 不匹配，文件已被他人修改），原样透传给前端。
      return jsonError(e.status, e.status === 409 ? "EDIT_CONFLICT" : "GITHUB_ERROR", e.message);
    }
    return jsonError(500, "UNKNOWN_ERROR", String(e));
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  const claims = token ? await verifyAdminJwt(token, env.ADMIN_JWT_SECRET) : null;
  if (!claims) return jsonError(401, "UNAUTHORIZED", "Login required");

  const body = (await request.json().catch(() => ({}))) as {
    section?: string;
    path?: string;
    sha?: string;
    message?: string;
  };
  const { section, path, sha } = body;
  if (!section || !path || !sha) {
    return jsonError(400, "INVALID_REQUEST", "section, path and sha are required");
  }

  const repo = resolveRepo(env, section);
  if (!repo) return jsonError(404, "UNKNOWN_SECTION", `Unknown section: ${section}`);

  try {
    await deleteFile({
      repo,
      path,
      sha,
      message: body.message || `docs: delete ${path} via doc editor`,
      authorName: claims.email,
      authorEmail: claims.email,
      token: env.GITHUB_TOKEN,
    });
    return Response.json({ success: true, data: null });
  } catch (e) {
    if (e instanceof GithubApiError) {
      // 409 = 删除冲突（sha 不匹配，文件已被他人修改），原样透传给前端。
      return jsonError(e.status, e.status === 409 ? "EDIT_CONFLICT" : "GITHUB_ERROR", e.message);
    }
    return jsonError(500, "UNKNOWN_ERROR", String(e));
  }
};
