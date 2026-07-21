import { defineConfig } from "vitepress";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// nav-data.json 由 scripts/gen-nav.mjs 在构建前生成（见 package.json build 脚本）。
// 结构：{ [sectionKey]: { label, sidebar }, __meta: { customSections, syncedSections, syncedGroupLabel } }
// 本地首次 `vitepress dev` 若尚未生成过，兜底给空结构，避免报错。
const navDataPath = path.join(__dirname, "nav-data.json");
const navData = fs.existsSync(navDataPath)
  ? JSON.parse(fs.readFileSync(navDataPath, "utf8"))
  : {
      general: { label: "综合文档", sidebar: [] },
      account: { label: "Account (SSO)", sidebar: [] },
      relay: { label: "Relay", sidebar: [] },
      analytics: { label: "Analytics", sidebar: [] },
      __meta: {
        customSections: ["general"],
        syncedSections: ["account", "relay", "analytics"],
        syncedGroupLabel: "业务文档",
      },
    };

const meta = navData.__meta || {
  customSections: ["general"],
  syncedSections: ["account", "relay", "analytics"],
  syncedGroupLabel: "业务文档",
};
const { customSections, syncedSections, syncedGroupLabel } = meta;

export default defineConfig({
  title: "Relay 文档中心",
  description: "统一查阅 · 网页编辑 · 代码同步",
  lang: "zh-CN",
  cleanUrls: true,
  ignoreDeadLinks: true,

  themeConfig: {
    // 顶部导航：自定义分类（general 及网页端新建的任意分类）各自一级入口，
    // 外加一个固定的"业务文档"下拉（收纳 account/relay/analytics 这三个同步类）
    // 和一个"＋ 新建分类"入口（跳转到编辑器，直接弹出新建分类流程，见
    // editor/src/App.tsx 对 URL 参数 action=create-section 的处理）。
    nav: [
      ...customSections.map((key: string) => ({
        text: navData[key]?.label || key,
        link: `/${key}/`,
      })),
      {
        text: syncedGroupLabel,
        items: syncedSections.map((key: string) => ({
          text: navData[key]?.label || key,
          link: `/${key}/`,
        })),
      },
      {
        text: "＋ 新建分类",
        link: "/edit/?action=create-section",
        target: "_self",
      },
    ],

    sidebar: Object.fromEntries(
      [...customSections, ...syncedSections].map((key: string) => [
        `/${key}/`,
        navData[key]?.sidebar || [],
      ])
    ),

    search: { provider: "local" },

    outline: { level: [2, 3] },

    socialLinks: [
      { icon: "github", link: "https://github.com/helloworld2025" },
    ],
  },

  // 自定义主题（注入登录状态感知的顶部条 + "编辑此页"按钮），见 theme/index.ts
  vite: {
    server: {
      proxy: {
        "/api": "http://localhost:8788",
      },
    },
  },
});
