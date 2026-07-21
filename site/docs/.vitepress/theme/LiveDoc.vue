<!--
  查看文档时的"实时内容"补丁：

  背景：VitePress 站点里 account/relay/analytics/general 的正文，是
  scripts/sync-sources.mjs 在上次 dev/deploy 时从源仓库拉取后静态构建出来的
  HTML，天然存在"距离上次部署以来源仓库新提交还没同步过来"的时间差；而网页
  编辑器的 /api/file 每次都是直接现读 GitHub 最新内容。这导致"查看"和"编辑"
  两个入口看到的版本可能不一致。

  这个组件在每次进入文档页面时，用与 EditLink.vue 相同的映射规则
  （见 ./docMapping.ts）换算出 section + 源仓库文件路径，调用同一个
  /api/file 接口把最新 Markdown 拉回来，在浏览器端渲染后替换掉静态构建的正文
  容器（.vp-doc），从而让"查看"也始终显示最新内容。

  取舍 / 已知限制：
  - 该接口受 functions/_middleware.ts 全站鉴权保护，未登录会直接跳转登录页，
    不会在这里额外处理；已登录用户可正常拉取。
  - 纯预览模式（dev.sh 不带 --full）没有部署 Functions，请求会失败，这里静默
    忽略，保留原有静态内容，不影响可用性。
  - 客户端用 marked 做轻量 Markdown → HTML 渲染，效果和 VitePress 构建期的
    高级语法（自定义容器、代码组 tabs、Shiki 高亮等）不完全一致，但常见的标题
    /列表/代码块/表格/图片没有问题。
  - 新增/删除文件后的侧边栏导航结构仍然只在下次 sync + build + deploy 后才更新，
    这里只保证"已存在页面"的正文内容始终最新。
-->
<script setup lang="ts">
import { useData } from "vitepress";
import { onMounted, watch } from "vue";
import { marked } from "marked";
import { resolveDocSource } from "./docMapping";


const { page } = useData();

// 简单 slugify，逻辑上与常见 Markdown 渲染器的标题锚点规则接近，
// 让实时渲染出的标题也带上 id，页面内 # 锚点跳转仍然可用。
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, "")
    .replace(/\s+/g, "-");
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

const renderer = new marked.Renderer();
const usedSlugs = new Set<string>();
renderer.heading = ({ tokens, depth }) => {
  const text = tokens.map((t: any) => t.raw ?? t.text ?? "").join("");
  let slug = slugify(text) || "section";
  let uniqueSlug = slug;
  let i = 1;
  while (usedSlugs.has(uniqueSlug)) {
    uniqueSlug = `${slug}-${i++}`;
  }
  usedSlugs.add(uniqueSlug);
  return `<h${depth} id="${uniqueSlug}" tabindex="-1">${text}</h${depth}>\n`;
};

let requestToken = 0;

async function refresh() {
  if (typeof document === "undefined") return;
  const relPath = page.value.relativePath;
  if (!relPath) return;

  const { section, filePath } = resolveDocSource(relPath);
  if (!section) return;


  const token = ++requestToken;
  try {
    const res = await fetch(
      `/api/file?section=${encodeURIComponent(section)}&path=${encodeURIComponent(filePath)}`,
      { credentials: "include" }
    );
    // 401（未登录，中间件会跳转登录页）/ 404（本地纯预览没有部署 Functions）/
    // 网络异常等情况一律静默忽略，保留原有静态内容。
    if (!res.ok) return;
    const json = (await res.json().catch(() => null)) as
      | { success: boolean; data?: { content: string } }
      | null;
    if (!json?.success || typeof json.data?.content !== "string") return;

    // 拉取期间用户已经跳到别的页面，丢弃这次结果，避免串页。
    if (token !== requestToken) return;

    const container = document.querySelector<HTMLElement>(".vp-doc");
    if (!container) return;

    usedSlugs.clear();
    const html = marked.parse(stripFrontmatter(json.data.content), {
      async: false,
      renderer,
    }) as string;
    container.innerHTML = html;
  } catch {
    // 静默失败，保留静态内容。
  }
}

onMounted(refresh);
watch(() => page.value.relativePath, refresh);
</script>

<template></template>
