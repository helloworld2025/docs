// /api/tree（doc-tree.json）里的 path 是相对镜像目录的路径（例如 "index.md"、
// "docs/xxx.md"），跟真正调 /api/file 读写时需要的"源仓库真实路径"并不总是一致：
//
// 分类分两类（与 shared/sections.ts 保持一致定义，因编辑器是独立的 Vite 构建
// 上下文，不跨目录 import 后端 Functions 代码，这里单独维护一份）：
// - "同步类"分类（account/relay/analytics）：目录结构原样镜像自源仓库，"index.md"
//   是 sync-sources.mjs 的 ensureSectionIndex 从源仓库根目录 README.md 镜像生成
//   的合成文件（源仓库里并不存在 "index.md"），这种情况要指向源仓库根目录的
//   README.md，其余路径原样透传。
// - "自定义分类"（默认的 general，以及网页编辑器里新建的任意分类名）：本身就是
//   docs 仓库源码，但 VitePress 站点代码位于 docs 仓库的 site/ 子目录下，所以
//   真实路径要加上 "site/docs/<section>/" 前缀。
//
// 这个换算规则和 site/docs/.vitepress/theme/docMapping.ts（供 VitePress 主题"编辑
// 此页"使用）保持一致，两处分别服务于"查看页跳转编辑器"和"编辑器自身文件树"两个
// 不同入口，但换算逻辑必须一致，否则会出现 404。
export const SYNCED_SECTIONS = ["account", "relay", "analytics"];

export function isSyncedSection(section: string): boolean {
  return SYNCED_SECTIONS.includes(section);
}

export function treeEntryToApiPath(section: string, path: string): string {
  if (!isSyncedSection(section)) return `site/docs/${section}/${path}`;
  if (path === "index.md") return "README.md";
  return path;
}
