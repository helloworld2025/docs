<!--
  「✏️ 编辑此页」按钮：
  - 根据当前页面路径推断出 section（account/relay/analytics/general）与相对路径，
    跳转到网页编辑器 /edit/?section=xxx&path=yyy。
  - general 分区本身就是本仓库源码（docs 仓库），也走同一个编辑器写回 docs 仓库自身，
    但注意 VitePress 站点代码整体位于 docs 仓库的 site/ 子目录下，
    所以 general 分区文件在 docs 仓库里的真实路径是 site/docs/general/<rest>，
    不是仓库根目录下的 <rest>（否则会 404，见 shared/env.ts 的 SOURCE_REPOS 映射）。
  - account/relay/analytics 分区镜像目录（site/docs/<section>/）的目录结构是
    sync-sources.mjs 按源仓库配置的 paths（["docs", "README.md"]）原样镜像过来的，
    即 rest（去掉 section 前缀后的相对路径）本身就等于源仓库里的真实相对路径
    （例如 "docs/AI_MODEL_ROUTING.md"），不需要再手动拼 "docs/" 前缀，否则会
    变成错误的 "docs/docs/AI_MODEL_ROUTING.md" 导致 404。
  - 唯一例外是落地页 index.md：它是 sync-sources.mjs 的 ensureSectionIndex 从源
    仓库根目录的 README.md 镜像生成的合成文件（本身在源仓库里并不存在
    "index.md"），所以这种情况编辑目标要特殊指向源仓库根目录的 README.md。
-->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";

const { page } = useData();

const editHref = computed(() => {
  const relPath = page.value.relativePath; // e.g. "account/docs/oidc-flow.md" or "general/index.md"
  const parts = relPath.split("/");
  const section = parts[0];
  const rest = parts.slice(1).join("/") || "index.md";
  const filePath =
    section === "general"
      ? `site/docs/general/${rest}`
      : rest === "index.md"
        ? "README.md"
        : rest;
  return `/edit/?section=${encodeURIComponent(section)}&path=${encodeURIComponent(filePath)}`;
});
</script>





<template>
  <!--
    target="_self"：VitePress 会全局拦截页面内所有同源链接的点击事件，试图用自己的
    SPA 路由做客户端跳转（router.go），但 /edit/ 是完全独立的 React 应用，根本不在
    VitePress 路由表里，拦截后会直接渲染出 VitePress 自己的 404 组件（地址栏变了，
    但其实请求从未真正发出，curl 测不出这个问题）。加 target="_self" 后命中 VitePress
    路由拦截器的放行条件（见 framework 里 router click handler），会退回浏览器原生
    整页跳转，从而真正命中 Cloudflare Pages Functions 提供的 /edit/index.html。
  -->
  <a v-if="page.relativePath" class="doc-edit-link" :href="editHref" target="_self">✏️ 编辑此页</a>
</template>

