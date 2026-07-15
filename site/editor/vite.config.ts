import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 编辑器构建产物直接输出到 VitePress 的 public/edit 目录，
// 这样最终会随 `vitepress build` 一起打包进部署产物，
// 通过 /edit/ 路径访问（同域名，天然复用 _middleware 的鉴权 Cookie）。
export default defineConfig({
  base: "/edit/",
  plugins: [react()],
  build: {
    outDir: "../docs/public/edit",
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    proxy: {
      "/api": "http://localhost:8788",
    },
  },
});
