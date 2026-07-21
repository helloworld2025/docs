// 构建期脚本：
//   1. 扫描 docs/ 下所有分类目录，生成 docs/.vitepress/nav-data.json
//      （供 config.ts 生成 nav + sidebar）
//   2. 生成 docs/public/doc-tree.json（供网页编辑器 /api/tree 读取）
//
// 分类分两类（与 shared/sections.ts / editor/src/pathMapping.ts 保持一致定义，
// 这里是独立的 Node 脚本，不跨目录 import，单独维护一份）：
//   - "同步类"：account / relay / analytics，内容来自其他仓库镜像过来，固定收进
//     顶部导航一个"业务文档"下拉分组里，不能在网页端新建/删除这几个分类本身
//   - "自定义分类"：docs/ 目录下除同步类、.vitepress、public 外的所有其他子目录，
//     包括默认的 general，以及网页编辑器里新建的任意分类名，各自独立展示为
//     顶部导航的一级入口，可以在网页端任意新建/删除
//
// 在 `vitepress build` 之前运行（见 package.json 的 build 脚本）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.resolve(__dirname, "../docs");

const SYNCED_SECTIONS = ["account", "relay", "analytics"];
const RESERVED_DIRS = new Set([...SYNCED_SECTIONS, ".vitepress", "public"]);

const SYNCED_GROUP_LABEL = "业务文档";
const SYNCED_SECTION_LABELS = {
  account: "Account (SSO)",
  relay: "Relay",
  analytics: "Analytics",
};
const DEFAULT_SECTION_LABELS = {
  general: "综合文档",
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

// 自定义分类 = docs/ 下除同步类、.vitepress、public 外的所有子目录，
// 动态扫描而非写死列表，这样网页端新建的分类无需改代码即可生效（下次构建后）。
function discoverCustomSections() {
  const entries = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !RESERVED_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function sectionLabel(section) {
  return SYNCED_SECTION_LABELS[section] || DEFAULT_SECTION_LABELS[section] || section;
}

const customSections = discoverCustomSections();
// 保证默认的 general 分类目录始终存在，即使当前为空。
if (!customSections.includes("general")) {
  fs.mkdirSync(path.join(DOCS_DIR, "general"), { recursive: true });
  customSections.unshift("general");
  customSections.sort((a, b) => a.localeCompare(b));
}

const ALL_SECTIONS = [...customSections, ...SYNCED_SECTIONS];

const navData = {};
const docTree = {};

for (const section of ALL_SECTIONS) {
  const sectionDir = path.join(DOCS_DIR, section);
  if (!fs.existsSync(sectionDir)) {
    fs.mkdirSync(sectionDir, { recursive: true });
  }
  const items = walk(sectionDir);
  navData[section] = {
    label: sectionLabel(section),
    sidebar: toSidebarItems(items, section, `/${section}`),
  };
  docTree[section] = toFlatFileList(items, section);
}

// nav-data.json 额外附带分组信息，供 config.ts 生成"自定义分类各自一级入口 +
// 业务文档下拉分组（收纳同步类）"的顶部导航结构。
const meta = {
  customSections,
  syncedSections: SYNCED_SECTIONS,
  syncedGroupLabel: SYNCED_GROUP_LABEL,
};

const vitepressDir = path.join(DOCS_DIR, ".vitepress");
fs.mkdirSync(vitepressDir, { recursive: true });
fs.writeFileSync(
  path.join(vitepressDir, "nav-data.json"),
  JSON.stringify({ ...navData, __meta: meta }, null, 2),
  "utf8"
);

const publicDir = path.join(DOCS_DIR, "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "doc-tree.json"), JSON.stringify(docTree, null, 2), "utf8");

console.log("✅ nav-data.json / doc-tree.json 生成完成");
console.log(`   自定义分类: ${customSections.join(", ")}`);
console.log(`   业务文档（同步类）: ${SYNCED_SECTIONS.join(", ")}`);
