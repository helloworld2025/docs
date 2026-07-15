import { defineConfig } from "vitepress";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// nav-data.json 由 scripts/gen-nav.mjs 在构建前生成（见 package.json build 脚本）。
// 本地首次 `vitepress dev` 若尚未生成过，兜底给空结构，避免报错。
const navDataPath = path.join(__dirname, "nav-data.json");
const navData = fs.existsSync(navDataPath)
  ? JSON.parse(fs.readFileSync(navDataPath, "utf8"))
  : { general: { label: "公司通用", sidebar: [] }, account: { label: "Account (SSO)", sidebar: [] }, relay: { label: "Relay", sidebar: [] }, analytics: { label: "Analytics", sidebar: [] } };

const SECTION_ORDER = ["general", "account", "relay", "analytics"];

export default defineConfig({
  title: "Relay 文档中心",
  description: "统一查阅 · 网页编辑 · 代码同步",
  lang: "zh-CN",
  cleanUrls: true,
  ignoreDeadLinks: true,

  themeConfig: {
    nav: SECTION_ORDER.map((key) => ({
      text: navData[key]?.label || key,
      link: `/${key}/`,
    })),

    sidebar: Object.fromEntries(
      SECTION_ORDER.map((key) => [`/${key}/`, navData[key]?.sidebar || []])
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
