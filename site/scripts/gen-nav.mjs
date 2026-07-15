// 构建期脚本：
//   1. 扫描 docs/{general,account,relay,analytics}/**/*.md，生成
//      docs/.vitepress/nav-data.json（供 config.ts 生成 nav + sidebar）
//   2. 生成 docs/public/doc-tree.json（供网页编辑器 /api/tree 读取）
//
// 在 `vitepress build` 之前运行（见 package.json 的 build 脚本）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../docs");
const SECTIONS = ["general", "account", "relay", "analytics"];

const SECTION_LABELS = {
  general: "公司通用",
  account: "Account (SSO)",
  relay: "Relay",
  analytics: "Analytics",
};

function walk(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const relPath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = walk(fullPath, relPath);
      if (children.length) items.push({ type: "dir", name: entry.name, path: relPath, children });
    } else if (entry.name.endsWith(".md")) {
      items.push({ type: "file", name: entry.name, path: relPath });
    }
  }
  return items;
}

function titleFromFilename(name) {
  return name.replace(/\.md$/, "");
}

/** 生成 VitePress sidebar items（递归） */
function toSidebarItems(items, sectionKey, basePath) {
  return items.map((item) => {
    if (item.type === "dir") {
      return {
        text: item.name,
        collapsed: true,
        items: toSidebarItems(item.children, sectionKey, basePath),
      };
    }
    const isIndex = item.name === "index.md";
    const link = `${basePath}/${item.path}`.replace(/\.md$/, isIndex ? "" : "");
    return { text: titleFromFilename(item.name), link };
  });
}

/** 生成编辑器用的扁平文件清单 */
function toFlatFileList(items, sectionKey, prefix = "") {
  let out = [];
  for (const item of items) {
    if (item.type === "dir") {
      out = out.concat(toFlatFileList(item.children, sectionKey, prefix));
    } else {
      out.push({ section: sectionKey, path: item.path, label: `${prefix}${item.path}` });
    }
  }
  return out;
}

const navData = {};
const docTree = {};

for (const section of SECTIONS) {
  const sectionDir = path.join(DOCS_DIR, section);
  if (!fs.existsSync(sectionDir)) {
    fs.mkdirSync(sectionDir, { recursive: true });
  }
  const items = walk(sectionDir);
  navData[section] = {
    label: SECTION_LABELS[section] || section,
    sidebar: toSidebarItems(items, section, `/${section}`),
  };
  docTree[section] = toFlatFileList(items, section);
}

const vitepressDir = path.join(DOCS_DIR, ".vitepress");
fs.mkdirSync(vitepressDir, { recursive: true });
fs.writeFileSync(path.join(vitepressDir, "nav-data.json"), JSON.stringify(navData, null, 2), "utf8");

const publicDir = path.join(DOCS_DIR, "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "doc-tree.json"), JSON.stringify(docTree, null, 2), "utf8");

console.log("✅ nav-data.json / doc-tree.json 生成完成");
