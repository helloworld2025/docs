// 跨仓库文档同步脚本 —— 通过 GitHub REST API 拉取 account / relay / analytics
// 仓库中配置好的文档路径，整体覆盖写入 site/docs/<key>/ 对应镜像目录。
//
// 不使用 git clone / sparse-checkout：这些仓库体积较大（尤其 relay 含大量构建产物），
// 纯 HTTP API 方式更轻量，且天然只拉取配置好的路径。
//
// 用法：
//   SYNC_GITHUB_TOKEN=<token> node scripts/sync-sources.mjs
//
// 冲突处理原则：源仓库永远是唯一真相。本脚本每次同步都是"整体覆盖"
// （先清空镜像目录再写入最新内容），不做 diff/merge —— 因为镜像目录从不会被
// 网页编辑器或人工直接修改，不存在真正的双向冲突。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../site/docs");

const TOKEN = process.env.SYNC_GITHUB_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("❌ 缺少 SYNC_GITHUB_TOKEN（需要 account/relay/analytics 仓库读权限）");
  process.exit(1);
}

// ── 同步源配置：按需增删 paths（目录或单个文件均可）─────────────────────
const SOURCES = [
  { key: "account", repo: "helloworld2025/account", paths: ["docs", "README.md"] },
  { key: "relay", repo: "helloworld2025/relay", paths: ["docs", "README.md"] },
  { key: "analytics", repo: "helloworld2025/analytics", paths: ["README.md"] },
];

function ghHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "User-Agent": "relay-doc-sync",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getDefaultBranch(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`获取仓库信息失败 (${res.status})`);
  const data = await res.json();
  return data.default_branch;
}

async function getTree(repo, branch) {
  const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`获取目录树失败 (${res.status})`);
  const data = await res.json();
  if (data.truncated) {
    console.warn(`  ⚠️  ${repo} 目录树被截断（文件数过多），部分文件可能未同步`);
  }
  return data.tree || [];
}

async function getRawContent(repo, filePath, branch) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${encodedPath}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`拉取文件失败 ${filePath} (${res.status})`);
  return res.text();
}

function matchesConfiguredPaths(filePath, configuredPaths) {
  return configuredPaths.some((p) => filePath === p || filePath.startsWith(`${p}/`));
}

async function syncSource(source) {
  const branch = await getDefaultBranch(source.repo);
  const tree = await getTree(source.repo, branch);
  const mdFiles = tree.filter(
    (t) => t.type === "blob" && t.path.endsWith(".md") && matchesConfiguredPaths(t.path, source.paths)
  );

  const targetDir = path.join(DOCS_DIR, source.key);
  // 整体覆盖：先清空旧镜像目录，避免残留已在源仓库删除的文件。
  // 注意：手工维护的 docs/<key>/index.md 落地页不受影响 —— 它只在 targetDir
  // 根目录，源仓库路径里几乎不会出现同名冲突；如冲突请调整落地页文件名。
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const manifestEntries = {};
  for (const file of mdFiles) {
    const content = await getRawContent(source.repo, file.path, branch);
    const destPath = path.join(targetDir, file.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, "utf8");
    manifestEntries[`${source.key}/${file.path}`] = { repo: source.repo, path: file.path, sha: file.sha };
    console.log(`  ✔ ${source.key}/${file.path}`);
  }
  return manifestEntries;
}

async function main() {
  console.log("🔄 开始同步文档...\n");
  let manifest = {};
  let hadError = false;

  for (const source of SOURCES) {
    console.log(`📦 ${source.key} (${source.repo})`);
    try {
      const entries = await syncSource(source);
      manifest = { ...manifest, ...entries };
    } catch (e) {
      console.error(`  ❌ 同步失败: ${e.message}`);
      hadError = true;
    }
    console.log("");
  }

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DOCS_DIR, ".sync-manifest.json"),
    JSON.stringify({ syncedAt: new Date().toISOString(), files: manifest }, null, 2),
    "utf8"
  );

  if (hadError) {
    console.error("⚠️  同步完成，但部分仓库失败，请检查上方日志");
    process.exitCode = 1;
  } else {
    console.log("✅ 全部同步完成");
  }
}

main();
