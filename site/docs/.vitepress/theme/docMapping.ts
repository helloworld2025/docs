// 页面 relativePath → 源仓库真实文件路径的换算逻辑，供
// EditLink.vue（跳转到编辑器）与 LiveDoc.vue（查看时实时拉取最新内容）共用，
// 避免两处各写一份、行为走偏。
//
// 分类分两类（与 shared/sections.ts 保持一致定义，因 VitePress 主题是独立的
// Vite 构建上下文，不跨目录 import 后端 Functions 代码，这里单独维护一份）：
// - "同步类"分类（account/relay/analytics）：镜像目录（site/docs/<section>/）的
//   目录结构是 sync-sources.mjs 按源仓库配置的 paths（["docs", "README.md"]）
//   原样镜像过来的，即 rest（去掉 section 前缀后的相对路径）本身就等于源仓库里
//   的真实相对路径（例如 "docs/AI_MODEL_ROUTING.md"），不需要再手动拼 "docs/"
//   前缀；落地页 index.md 是 sync-sources.mjs 的 ensureSectionIndex 从源仓库根
//   目录的 README.md 镜像生成的合成文件（源仓库里并不存在 "index.md"），这种
//   情况要特殊指向源仓库根目录的 README.md。
// - "自定义分类"（默认的 general，以及网页编辑器里新建的任意分类名）：本身就是
//   docs 仓库源码，但 VitePress 站点代码整体位于 docs 仓库的 site/ 子目录下，
//   所以文件在 docs 仓库里的真实路径要加上 "site/docs/<section>/" 前缀。
export const SYNCED_SECTIONS = ["account", "relay", "analytics"];

export interface DocSource {
  section: string;
  filePath: string;
}

/** 根据 VitePress 页面的 relativePath（如 "account/docs/oidc-flow.md"）计算出
 *  section + 源仓库里的真实文件路径。 */
export function resolveDocSource(relativePath: string): DocSource {
  const parts = relativePath.split("/");
  const section = parts[0];
  const rest = parts.slice(1).join("/") || "index.md";
  const isSynced = SYNCED_SECTIONS.includes(section);
  const filePath = isSynced
    ? rest === "index.md"
      ? "README.md"
      : rest
    : `site/docs/${section}/${rest}`;
  return { section, filePath };
}
