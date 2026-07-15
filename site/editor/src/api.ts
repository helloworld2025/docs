// 编辑器与后端 Functions 的交互封装。
// 鉴权走 httpOnly Cookie（doc_session），浏览器自动携带，无需手动处理 token。

export interface DocTreeFile {
  section: string;
  path: string;
  label: string;
}

export type DocTree = Record<string, DocTreeFile[]>;

export interface FileData {
  content: string;
  sha: string;
  repo: string;
  path: string;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });

  if (res.status === 401) {
    location.href = `/login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    throw new Error("unauthorized");
  }

  const json = (await res.json()) as { success: boolean; data?: T; error?: { code: string; message: string } };
  if (!res.ok || !json.success) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`) as Error & { code?: string; status?: number };
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }
  return json.data as T;
}

export const docApi = {
  tree: () => req<DocTree>("/api/tree"),

  getFile: (section: string, path: string) =>
    req<FileData>(`/api/file?section=${encodeURIComponent(section)}&path=${encodeURIComponent(path)}`),

  saveFile: (section: string, path: string, content: string, sha: string | undefined, message?: string) =>
    req<{ sha: string }>("/api/file", {
      method: "PUT",
      body: JSON.stringify({ section, path, content, sha, message }),
    }),

  logout: () => req<void>("/api/auth/logout", { method: "POST" }).catch(() => {}),
};
