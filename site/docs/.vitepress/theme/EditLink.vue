<!--
  「✏️ 编辑此页」按钮：根据当前页面路径推断出 section（account/relay/analytics/general）
  与源仓库里的真实文件路径（见 ./docMapping.ts），跳转到网页编辑器
  /edit/?section=xxx&path=yyy。
-->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";
import { resolveDocSource } from "./docMapping";

const { page } = useData();

const editHref = computed(() => {
  const relPath = page.value.relativePath; // e.g. "account/docs/oidc-flow.md" or "general/index.md"
  const { section, filePath } = resolveDocSource(relPath);
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
