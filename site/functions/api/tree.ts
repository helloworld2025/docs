// GET /api/tree —— 返回可编辑的文档目录树（供编辑器左侧文件浏览器使用）。
// 直接扫描构建产物里打包进 Functions 的文档源码目录列表——为避免运行时依赖文件系统
// （Pages Functions 不支持读取部署包外的任意文件系统路径），改为在构建期生成静态清单
// docs/public/doc-tree.json，这里直接透传该文件内容（由 _middleware 保护，无需重复鉴权逻辑）。
import type { Env } from "../../shared/env";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const res = await env.ASSETS.fetch("https://placeholder/doc-tree.json");
  if (!res.ok) {
    return Response.json({ success: false, error: { code: "TREE_NOT_FOUND", message: "doc-tree.json missing — run build" } }, { status: 500 });
  }
  const tree = await res.json();
  return Response.json({ success: true, data: tree });
};
