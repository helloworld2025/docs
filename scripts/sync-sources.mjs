// 跨仓库文档同步脚本 —— 拉取 account / relay / analytics 仓库中配置好的文档路径，
// 整体覆盖写入 site/docs/<key>/ 对应镜像目录。
//
// 优先使用【本地模式】：如果这些仓库已经作为同级目录 clone 在本 workspace 下
// （如 /Users/xxx/code/1/{account,relay,analytics,docs}，见根目录 repos.json），
// 直接从本地文件系统复制，无需任何网络请求 / Token，适合本地开发预览。
//
// 找不到本地目录时，回退到【远程模式】：通过 GitHub REST API 拉取
// （CI / 生产环境定时同步使用，不使用 git clone / sparse-checkout 是因为这些仓库
// 体积较大，纯 HTTP API 方式更轻量，且天然只拉取配置好的路径）。
//
// 用法：
//   node scripts/sync-sources.mjs                          # 本地模式（默认，找得到本地仓库目录时）
//   SYNC_GITHUB_TOKEN=<token> node scripts/sync-sources.mjs # 远程模式（本地目录不存在时自动回退，或显式设置 FORCE_REMOTE_SYNC=1 强制走远程）
//
// 冲突处理原则：源仓库永远是唯一真相。本脚本每次同步都是"整体覆盖"
// （先清空镜像目录再写入最新内容），不做 diff/merge —— 因为镜像目录从不会被
// 网页编辑器或人工直接修改，不存在真正的双向冲突。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../site/docs");
// docs 仓库自身的父目录，本地开发时 account/relay/analytics 通常与 docs 平级
// __dirname = <workspace>/docs/scripts，所以只需向上两级即可到 <workspace>
const WORKSPACE_ROOT = path.resolve(__dirname, "../..");


const FORCE_REMOTE = process.env.FORCE_REMOTE_SYNC === "1";
const TOKEN = process.env.SYNC_GITHUB_TOKEN || process.env.GITHUB_TOKEN;

// ── 同步源配置：按需增删 paths（目录或单个文件均可）─────────────────────
const SOURCES = [
  { key: "account", repo: "helloworld2025/account", localDir: "account", paths: ["docs", "README.md"] },
  { key: "relay", repo: "helloworld2025/relay", localDir: "relay", paths: ["docs", "README.md"] },
  { key: "analytics", repo: "helloworld2025/analytics", localDir: "analytics", paths: ["README.md"] },
];

function findLocalRepoDir(source) {
  if (FORCE_REMOTE) return null;
  const dir = path.join(WORKSPACE_ROOT, source.localDir);
  return fs.existsSync(path.join(dir, ".git")) ? dir : null;
}


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

function listLocalMdFiles(rootDir, configuredPaths) {
  const results = [];
  for (const p of configuredPaths) {
    const abs = path.join(rootDir, p);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (abs.endsWith(".md")) results.push(p);
      continue;
    }
    // 目录：递归收集所有 .md 文件
    const walk = (dir, relBase) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const relPath = path.join(relBase, entry.name);
        const absPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absPath, relPath);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(relPath);
        }
      }
    };
    walk(abs, p);
  }
  return results;
}

function prepareTargetDir(source) {
  const targetDir = path.join(DOCS_DIR, source.key);
  // 整体覆盖：先清空旧镜像目录，避免残留已在源仓库删除的文件。
  // 注意：手工维护的 docs/<key>/index.md 落地页不受影响 —— 它只在 targetDir
  // 根目录，源仓库路径里几乎不会出现同名冲突；如冲突请调整落地页文件名。
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  return targetDir;
}

function syncSourceLocal(source, localDir) {
  const targetDir = prepareTargetDir(source);
  const relFiles = listLocalMdFiles(localDir, source.paths);

  const manifestEntries = {};
  for (const relPath of relFiles) {
    const srcPath = path.join(localDir, relPath);
    const destPath = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    manifestEntries[`${source.key}/${relPath}`] = { source: "local", localDir, path: relPath };
    console.log(`  ✔ ${source.key}/${relPath}`);
  }
  return manifestEntries;
}

async function syncSourceRemote(source) {
  if (!TOKEN) {
    throw new Error("本地未找到仓库目录，且缺少 SYNC_GITHUB_TOKEN（远程模式需要 account/relay/analytics 仓库读权限）");
  }
  const branch = await getDefaultBranch(source.repo);
  const tree = await getTree(source.repo, branch);
  const mdFiles = tree.filter(
    (t) => t.type === "blob" && t.path.endsWith(".md") && matchesConfiguredPaths(t.path, source.paths)
  );

  const targetDir = prepareTargetDir(source);

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

// VitePress 访问 /<section>/ 这个目录路径时，要求该目录下存在 index.md 才能渲染，
// 否则 404。但源仓库的文档目录根下通常只有 README.md（没有 index.md），
// 所以镜像同步完成后，如果根目录缺 index.md、但有 README.md，就镜像一份写成
// index.md（不影响 README.md 本身，两者内容一致，各自可独立访问）。
function ensureSectionIndex(source) {
  const targetDir = path.join(DOCS_DIR, source.key);
  const indexPath = path.join(targetDir, "index.md");
  const readmePath = path.join(targetDir, "README.md");
  if (!fs.existsSync(indexPath) && fs.existsSync(readmePath)) {
    fs.copyFileSync(readmePath, indexPath);
    console.log(`  ✔ ${source.key}/index.md (从 README.md 生成，供 /${source.key}/ 落地页使用)`);
  }
}

async function main() {
  console.log("🔄 开始同步文档...\n");
  let manifest = {};
  let hadError = false;

  for (const source of SOURCES) {
    const localDir = findLocalRepoDir(source);
    console.log(`📦 ${source.key} (${localDir ? `本地: ${localDir}` : `远程: ${source.repo}`})`);
    try {
      const entries = localDir ? syncSourceLocal(source, localDir) : await syncSourceRemote(source);
      manifest = { ...manifest, ...entries };
      ensureSectionIndex(source);
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
