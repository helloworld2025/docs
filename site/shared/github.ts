// GitHub Contents API 封装 —— 网页编辑器读写源仓库文件的唯一途径。
// 使用乐观并发控制（blob sha）：保存时若 sha 不匹配，GitHub 返回 409，
// 原样透传给前端，避免静默覆盖他人修改。

const API_BASE = "https://api.github.com";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "relay-docs-editor",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface GhFile {
  content: string; // 解码后的 UTF-8 文本
  sha: string;
}

export class GithubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 读取文件内容 + 当前 blob sha */
export async function getFile(repo: string, path: string, token: string): Promise<GhFile> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${encodedPath}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) {
    throw new GithubApiError(res.status, `读取文件失败: ${repo}/${path} (${res.status})`);
  }
  const data = (await res.json()) as { content: string; sha: string; encoding: string };
  const content = data.encoding === "base64" ? b64DecodeUtf8(data.content) : data.content;
  return { content, sha: data.sha };
}

/**
 * 写入文件（新建或更新）。
 * - 更新：必须传入当前 sha（乐观并发控制），冲突时 GitHub 返回 409，此处原样抛出。
 * - 新建：sha 传 undefined。
 */
export async function putFile(params: {
  repo: string;
  path: string;
  content: string;
  message: string;
  sha?: string;
  authorName?: string;
  authorEmail?: string;
  token: string;
}): Promise<{ sha: string }> {
  const { repo, path, content, message, sha, token } = params;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  const body: Record<string, unknown> = {
    message,
    content: b64EncodeUtf8(content),
  };
  if (sha) body.sha = sha;
  if (params.authorName && params.authorEmail) {
    body.committer = { name: params.authorName, email: params.authorEmail };
  }

  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GithubApiError(res.status, `保存文件失败 (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

function b64EncodeUtf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64DecodeUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
