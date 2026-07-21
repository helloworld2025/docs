import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import type { Theme } from "vitepress";
import EditLink from "./EditLink.vue";
import LiveDoc from "./LiveDoc.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => h(EditLink),
      // LiveDoc 本身不渲染任何可见内容，只是在页面挂载/切换时把 .vp-doc 里的
      // 静态内容替换成从源仓库现读的最新 Markdown，详见 LiveDoc.vue 顶部注释。
      "doc-after": () => h(LiveDoc),
    });
  },
} satisfies Theme;
