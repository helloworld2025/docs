<!--
  「✏️ 编辑此页」按钮：
  - 根据当前页面路径推断出 section（account/relay/analytics/general）与相对路径，
    跳转到网页编辑器 /edit/?section=xxx&path=yyy。
  - general 分区本身就是本仓库源码，也走同一个编辑器（写回 doc 仓库自身）。
-->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";

const { page } = useData();

const editHref = computed(() => {
  const relPath = page.value.relativePath; // e.g. "account/oidc-flow.md" or "general/index.md"
  const parts = relPath.split("/");
  const section = parts[0];
  const rest = parts.slice(1).join("/") || "index.md";
  const filePath = section === "general" ? rest : `docs/${rest}`;
  return `/edit/?section=${encodeURIComponent(section)}&path=${encodeURIComponent(filePath)}`;
});
</script>

<template>
  <a v-if="page.relativePath" class="doc-edit-link" :href="editHref">✏️ 编辑此页</a>
</template>
