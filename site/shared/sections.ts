// 分类（一级导航）身份判定：
//
// - "同步类"分类（account / relay / analytics）内容来自其他仓库，由
//   scripts/sync-sources.mjs 按固定配置只读镜像过来，网页端不能新建/删除这几个
//   分类本身，只能编辑镜像范围内已同步的文件。
// - 除此之外的任意分类 key（包括默认的 general，以及网页编辑器里新建的任意
//   名字）都属于"自定义分类"，统一落在 docs 仓库自己的 site/docs/<key>/ 目录下，
//   支持在网页端任意新建/删除。SOURCE_REPOS 里 general 这个 key 配置的就是
//   docs 仓库自身（见 wrangler.toml），所有自定义分类复用这同一个仓库映射。
//
// 这份常量在后端 Functions（本文件）、VitePress 主题（docMapping.ts）、
// 编辑器前端（pathMapping.ts）三处各自维护一份相同定义（各自是独立的构建/打包
// 上下文，不跨项目 import 以避免 Vite dev server 的跨目录文件访问限制），
// 修改时需要三处保持一致。
export const SYNCED_SECTIONS = ["account", "relay", "analytics"] as const;

export function isSyncedSection(section: string): boolean {
  return (SYNCED_SECTIONS as readonly string[]).includes(section);
}
