export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  // Secrets
  ADMIN_JWT_SECRET: string;
  TURNSTILE_SECRET: string;
  GITHUB_TOKEN: string;

  // Vars
  TURNSTILE_SITE_KEY: string;
  /** JSON: { [sectionKey]: "owner/repo" } */
  SOURCE_REPOS: string;
}

export function sourceRepos(env: Env): Record<string, string> {
  try {
    return JSON.parse(env.SOURCE_REPOS || "{}");
  } catch {
    return {};
  }
}
