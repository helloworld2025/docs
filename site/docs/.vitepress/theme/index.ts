import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import type { Theme } from "vitepress";
import EditLink from "./EditLink.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      "doc-before": () => h(EditLink),
    });
  },
} satisfies Theme;
