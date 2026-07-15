# Relay 文档中心（docs）

统一聚合 `account` / `relay` / `analytics` 三个仓库的文档 + 公司通用文档，
支持**网页端直接编辑**和**代码方式（git push）**两种新增/修改文档的方式，
两者最终都写回各自源仓库的 Git 历史，不存在"两份数据源"的问题。

## 架构总览

```
account repo (docs/*.md)   relay repo (docs/*.md)   analytics repo (README等)
        │  git push 照常              │                    │
        └───────────────┬──────────────┴────────────────────┘
                         │ 定时 / 手动触发 scripts/sync-sources.mjs
                         │ （只读拉取 GitHub API，整体覆盖镜像目录）
                         ▼
                docs 仓库（本仓库）
                ├─ site/docs/general/    ← 公司通用文档，本仓库自身即是源头
                ├─ site/docs/account/    ← 只读镜像（源头是 account 仓库）
                ├─ site/docs/relay/      ← 只读镜像（源头是 relay 仓库）
                ├─ site/docs/analytics/  ← 只读镜像（源头是 analytics 仓库）
                ├─ site/functions/       ← Cloudflare Pages Functions（登录 + 编辑 API）
                └─ site/editor/          ← 网页端 Markdown 编辑器（React + Tiptap）
                         │
                         ▼
        Cloudflare Pages（docs.relay.tech，同域名同时提供文档站 + 登录 + 编辑 API）
```

**核心设计原则：源仓库永远是唯一真相（source of truth）**。
`site/docs/account|relay|analytics/` 下的内容都是只读镜像，任何页面底部的
「✏️ 编辑此页」都会跳转到网页编辑器并直接读写对应**源仓库**里的文件，
镜像目录本身从不会被网页编辑器直接修改。

## 目录结构

```
docs/
├── site/                       Cloudflare Pages 项目（文档站 + 登录 + 编辑 API 全部在这一个项目里）
│   ├── docs/                   VitePress 文档源码
│   │   ├── .vitepress/
│   │   │   ├── config.ts       启动时自动扫描目录生成导航/侧边栏
│   │   │   └── theme/          自定义主题（注入"编辑此页"链接）
│   │   ├── general/            公司通用文档（本仓库自身维护）
│   │   ├── account/            镜像（sync-sources.mjs 自动生成，勿手动改）
│   │   ├── relay/               镜像
│   │   ├── analytics/           镜像
│   │   └── public/
│   │       ├── login.html      独立登录页（纯静态，无需构建）
│   │       └── edit/           编辑器 SPA 构建产物（由 site/editor 构建生成）
│   ├── functions/              Cloudflare Pages Functions（后端）
│   │   ├── _middleware.ts      全站鉴权网关（未登录重定向 /login.html）
│   │   └── api/
│   │       ├── config.ts       公开：返回 Turnstile site key
│   │       ├── auth/           登录 / 登出 / 刷新
│   │       ├── tree.ts         文档树（供编辑器浏览）
│   │       └── file.ts         读取 / 保存文档（直接读写源仓库，GitHub Contents API）
│   ├── shared/                 Functions 共用逻辑（PBKDF2、JWT、Turnstile、GitHub API 封装）
│   ├── migrations/             D1 数据库迁移（admin_users 表）
│   ├── editor/                 网页编辑器 SPA（React + Tiptap 富文本，最终产出到 docs/public/edit）
│   ├── wrangler.toml
│   └── package.json
├── scripts/
│   ├── sync-sources.mjs        跨仓库拉取脚本（GitHub API，无需 git clone）
│   └── gen-admin-hash.mjs      生成初始管理员密码 hash（与 account 项目算法保持一致）
└── .github/workflows/
    └── sync-and-deploy.yml     定时同步 + 构建 + 部署到 Cloudflare Pages
```

## 鉴权设计

参考 `relay/admin` 的登录 UI 风格和 `account`/`relay-server` 现有的管理员账号体系
（PBKDF2-HMAC-SHA256 密码哈希 + Cloudflare Turnstile 人机校验 + JWT），
本项目实现了一套**完全独立**的管理员账号体系：

- D1 表 `admin_users`（`id / email / password_hash / role`），初始账号用
  `scripts/gen-admin-hash.mjs` 生成 hash 后手动 `wrangler d1 execute` 插入
- 登录成功后签发 HS256 JWT，写入 **httpOnly Cookie**（`doc_session`），
  因为需要保护的是**整站页面导航**（不仅是 API），Cookie 方式比
  `sessionStorage + Authorization Header` 更适合做全站网关拦截
- `functions/_middleware.ts` 拦截除 `/login.html`、`/api/auth/login`、
  `/api/auth/refresh`、`/api/config`、静态资源、`/edit/*` 外的所有请求，
  校验 Cookie 中的 JWT，未登录一律重定向到 `/login.html`
- 无状态设计，不维护 token 黑名单（与 `relay-server` 的 `admin_auth.rs` 保持一致的取舍），
  登出即清除 Cookie，JWT 有效期 24 小时

## 冲突处理

**(a) 定时镜像同步（`sync-sources.mjs`）**
- 每次同步 = 用源仓库最新内容**整体覆盖**对应镜像目录（先清空再写入），
  因为镜像目录不会被手动编辑，不存在真正的"双向修改"，只是单向覆盖
- GitHub Actions 用 `concurrency` 分组保证同一时间只有一个同步任务在跑
- 同步结果记录在 `site/docs/.sync-manifest.json`（同步时间、来源 commit sha），仅作审计用途

**(b) 网页编辑器直接写源仓库（真正可能冲突的场景）**
- 编辑器加载文件时记录当时的 GitHub blob `sha`，保存时把这个 `sha` 一并提交
- 如果文件已被他人修改（GitHub 返回 409），后端原样透传 409，
  前端提示「文件已被他人修改，请刷新后重新编辑」，不会静默覆盖丢失修改

## 快速开始（本地开发）

### 1. 创建 Cloudflare 资源（首次，仅需一次）

```bash
cd site
npx wrangler d1 create docs
# 把返回的 database_id 填入 wrangler.toml 的 [[d1_databases]] 部分

npx wrangler pages project create docs
```

### 2. 配置 Secrets

```bash
# JWT 签名密钥
openssl rand -base64 48 | npx wrangler pages secret put ADMIN_JWT_SECRET --project-name docs

# Cloudflare Turnstile（Dashboard 创建一个 Widget 后获得）
npx wrangler pages secret put TURNSTILE_SECRET --project-name docs

# 具备 account / relay / analytics / docs 四个仓库 contents 读写权限的
# GitHub Fine-grained Personal Access Token
npx wrangler pages secret put GITHUB_TOKEN --project-name docs
```

把 Turnstile 的 **site key**（非 secret）填入 `site/wrangler.toml` 的 `[vars] TURNSTILE_SITE_KEY`。

### 3. 数据库迁移 + 创建首个管理员账号

```bash
cd site
npm run migrate:remote

node ../scripts/gen-admin-hash.mjs "YourPassword123"
# 复制输出的 hash，执行：
npx wrangler d1 execute docs --remote --command \
  "INSERT INTO admin_users (id, email, password_hash, role) VALUES ('adm_1', 'you@relay.tech', '<上面的hash>', 'superadmin')"
```

### 4. 本地跑一次文档同步（可选，验证 sync 脚本）

```bash
export SYNC_GITHUB_TOKEN=<有 account/relay/analytics 只读权限的 token>
node scripts/sync-sources.mjs
```

### 5. 构建编辑器 + 站点并部署

```bash
cd site/editor && npm install && npm run build
cd .. && npm install && npm run build
npx wrangler pages deploy docs/.vitepress/dist --project-name docs
```

### 6. 绑定自定义域名

在 Cloudflare Dashboard 为 Pages 项目 `docs` 挂载自定义域名（如 `docs.relay.tech`）。

## 生产部署（自动化）

`.github/workflows/sync-and-deploy.yml` 会定时（默认每 10 分钟）+ 手动触发：
拉取 account/relay/analytics 最新文档 → 提交回本仓库 → 构建编辑器与站点 → 部署到 Cloudflare Pages。

需要在 `docs` GitHub 仓库的 Settings → Secrets 配置：

| Secret | 说明 |
|---|---|
| `SYNC_GITHUB_TOKEN` | 具备 account/relay/analytics 只读权限（同步用） |
| `CF_API_TOKEN` | Cloudflare API Token（Pages 部署权限） |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |

### 可选：近实时同步

如果希望 account/relay/analytics 仓库 push 后立即触发同步（而不是等定时轮询），
可以在这三个仓库各自的 CI 里加一步（push 到 `docs/**` 或 `README.md` 时触发）：

```yaml
- name: Notify docs repo to sync
  run: |
    curl -X POST \
      -H "Authorization: Bearer ${{ secrets.DOCS_REPO_DISPATCH_TOKEN }}" \
      -H "Accept: application/vnd.github+json" \
      https://api.github.com/repos/helloworld2025/docs/dispatches \
      -d '{"event_type":"docs-updated"}'
```

## 已知限制 / 后续可优化方向

- 网页编辑器目前只支持 Markdown 常见富文本元素（标题/列表/加粗/代码块等，基于 Tiptap StarterKit），
  复杂表格、脚注等语法建议直接用代码方式编辑
- 镜像文档中的相对链接（如指向同仓库内图片）暂未做路径重写，如有需要可在
  `scripts/sync-sources.mjs` 中扩展
- 当前 GitHub 写入直接提交到 `main` 分支，未走 PR 审核流程
