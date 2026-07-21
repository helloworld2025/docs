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
│   ├── sync-sources.mjs        跨仓库拉取脚本（统一通过 GitHub REST API + Token 同步）
│   └── gen-admin-hash.mjs      生成初始管理员密码 hash（与 account 项目算法保持一致）

├── dev.sh                      一键本地开发（默认纯预览，--full 联调登录/编辑器）
├── deploy.sh                   一键本地部署到 Cloudflare Pages（生产环境，无 GitHub Actions）
├── deploy.config.sh            部署明文配置（项目名/域名/Turnstile site key 等，可提交）
└── .env.secrets                部署密钥（JWT secret / Turnstile secret / GitHub token / 管理员密码，已 gitignore）
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
- `functions/_middleware.ts` 拦截除 `/login.html`（及 VitePress `cleanUrls` 重写后的
  `/login`）、`/api/auth/login`、`/api/auth/refresh`、`/api/config`、静态资源、
  `/edit/*` 外的所有请求，校验 Cookie 中的 JWT，未登录一律重定向到 `/login.html`

- 无状态设计，不维护 token 黑名单（与 `relay-server` 的 `admin_auth.rs` 保持一致的取舍），
  登出即清除 Cookie，JWT 有效期 24 小时

## 冲突处理

**(a) 镜像同步（`sync-sources.mjs`）不进 `docs` 仓库自身历史**
- `site/docs/{account,relay,analytics}/` 及 `.sync-manifest.json` 已加入
  `.gitignore`：它们是 `dev.sh`/`deploy.sh` 每次运行时从 GitHub API 重新拉取
  生成的构建产物，本身不是"真相"，源仓库才是。不提交进 git 历史，避免多人
  各自在本地跑同步 + push 时，因为这些文件产生无意义的 merge 冲突
- 每次同步 = 用源仓库最新内容**整体覆盖**对应镜像目录（先清空再写入）

**(b) 网页编辑器直接写源仓库（真正可能冲突的场景）**
- 编辑器加载文件时记录当时的 GitHub blob `sha`，保存时把这个 `sha` 一并提交
- 如果文件已被他人修改（GitHub 返回 409），后端原样透传 409，
  前端提示「文件已被他人修改，请刷新后重新编辑」，不会静默覆盖丢失修改
- 网页编辑器直接对源仓库发起 GitHub Contents API 提交，不经过本地 git clone，
  跟工程师日常在本地 IDE 里改代码提交完全独立，正常情况下不会冲突；只有当
  两边**同时改同一份 `.md` 文件**时才可能出现上述 409，按提示刷新重新编辑即可


## 本地开发 / 本地部署（无需 GitHub Actions）

本项目**完全在本机操作**，不依赖任何 CI/CD：

- 文档同步（`scripts/sync-sources.mjs`）统一通过 GitHub REST API 拉取
  `account` / `relay` / `analytics` 仓库最新内容，需要 `.env.secrets` 里配置
  `GITHUB_TOKEN`（或环境变量 `SYNC_GITHUB_TOKEN`），确保拿到的始终是 GitHub
  上的最新版本，不依赖本地是否 clone 了这几个仓库
- 部署（`deploy.sh`）直接在本机跑 `wrangler` 命令，首次会自动创建
  Cloudflare 资源（D1、Pages 项目），之后重复执行只做"同步 + 构建 + 部署"


### 1. 一键本地开发

```bash
cd docs
bash dev.sh          # 纯内容预览（同步文档 + vitepress dev，热更新），http://localhost:5173
bash dev.sh --full   # 完整模式：联调登录 / 在线编辑器 / API（wrangler pages dev --local）
```

### 2. 配置部署密钥（首次）

```bash
cd docs
cp .env.secrets.example .env.secrets
# 编辑 .env.secrets，填写：
#   ADMIN_JWT_SECRET  openssl rand -base64 48 生成
#   TURNSTILE_SECRET  Cloudflare Turnstile Dashboard 获取
#   GITHUB_TOKEN      可选，account/relay/analytics/docs 四仓库 Contents 读写权限的
#                     GitHub Fine-grained PAT（用于在线编辑器保存文档，不填则该功能不可用）
#   ADMIN_PASSWORD    初始管理员登录密码
```

非敏感的项目命名 / 域名 / Turnstile site key / 管理员邮箱在 `deploy.config.sh`
里维护（可提交到代码库），Cloudflare 侧资源统一加 `-pro` 后缀，为未来拆分
test/pro 等多环境预留命名空间。

### 3. 一键部署到生产

```bash
cd docs
bash deploy.sh
```

`deploy.sh` 会依次执行：同步文档 → 安装依赖 → 检查/创建 D1 数据库（`docs-pro`）→
检查/创建 Pages 项目（`docs-pro`）→ 应用 D1 迁移 → 生成管理员账号并写入 D1 →
写入 Cloudflare Pages Secrets（`ADMIN_JWT_SECRET` / `TURNSTILE_SECRET` /
`GITHUB_TOKEN`）→ 构建 editor SPA + VitePress 静态站点 → `wrangler pages deploy`。

首次部署完成后，需要在 Cloudflare Dashboard 为 Pages 项目 `docs-pro`
手动绑定自定义域名（如 `docs.relay.tech`），后续再跑 `bash deploy.sh`
只做增量部署，安全可重复执行。


## 查看页面的实时内容

`site/docs/{account,relay,analytics,general}/` 下的正文在构建时会编译成静态
HTML，天然存在"距离上次 `sync + build + deploy` 以来源仓库有新提交，但还没
重新构建部署"的时间差。为了让**查看**页面也和**编辑器**一样始终展示源仓库最新
内容，主题层（`site/docs/.vitepress/theme/LiveDoc.vue`）在每次进入文档页面时
会用 `docMapping.ts` 里与"编辑此页"共用的换算规则算出 section + 源仓库文件
路径，调用已有的 `/api/file` 接口现读 GitHub 最新 Markdown，客户端用 `marked`
渲染后替换掉静态正文容器（`.vp-doc`）。

取舍：
- 只覆盖"已存在页面"的正文内容；新增/删除文件后的侧边栏导航结构仍然只在下次
  `sync + build + deploy` 后才更新
- 客户端 `marked` 渲染与 VitePress 构建期的部分高级语法（自定义容器、代码组
  tabs 等）效果不完全一致，常见标题/列表/代码块/表格/图片没有问题
- 纯预览模式（`bash dev.sh` 不带 `--full`）没有部署 Functions，`/api/file`
  请求会失败并静默忽略，仍展示构建时的静态内容

## 网页编辑器的新增 / 删除文档

编辑器左侧新增了文档目录侧边栏（`site/editor/src/Sidebar.tsx`），除了点击文件名
切换编辑，每个分区标题旁的 "＋" 可新建文档，每个文件条目右侧的 🗑 可删除文档：

- 新建：调用 `PUT /api/file`（不传 `sha`），与 GitHub Contents API 的"新建"语义
  一致，创建后自动刷新目录树并跳转到新文档
- 删除：新增 `DELETE /api/file`（`shared/github.ts` 的 `deleteFile`），同样走 sha
  乐观并发控制，删除前会先重新拉取一次最新 `sha`，避免用目录树里的旧 `sha` 导致
  GitHub 返回 409
- 新建/删除产生的 commit 会直接进入源仓库的 git 历史，跟网页编辑保存的处理方式
  一致；侧边栏目录树本身来自 `/api/tree`（构建期生成的 `doc-tree.json`），操作后
  前端会重新拉取该接口，但文档站点的**侧边栏导航 / 路由**仍然要等下次
  `sync + build + deploy` 才会体现新增/删除的文件（与"查看页面的实时内容"一节的
  已知限制一致）

## 分类体系：自定义一级分类 + 业务文档分组

文档分类分两种（判定逻辑见 `shared/sections.ts`，各构建上下文各维护一份保持一致
定义：`shared/sections.ts` 供 Functions 用，`docs/.vitepress/theme/docMapping.ts`
供 VitePress 主题用，`editor/src/pathMapping.ts` 供编辑器用）：

- **同步类**（固定为 `account` / `relay` / `analytics`）：内容来自其他仓库只读镜像，
  不能在网页端新建/删除这几个分类本身，顶部导航固定收进一个"业务文档"下拉分组
- **自定义分类**（默认的 `general`，展示名"综合文档"，以及网页编辑器里新建的任意
  分类名）：内容直接落在 docs 仓库自己的 `site/docs/<分类名>/` 目录下，可以在网页端
  任意新建/删除，各自在顶部导航展示为独立的一级入口

后端 `resolveRepo()`（`functions/api/file.ts`）按 section 是否属于同步类分流：
属于则按 `SOURCE_REPOS` 里配置的源仓库解析，否则一律解析到 docs 仓库自身
（即 `SOURCE_REPOS.general` 配置的仓库），因此新建自定义分类不需要改
`wrangler.toml`，也不需要逐一配置。

编辑器侧边栏顶部新增"＋分类"按钮（`Sidebar.tsx` 的 `onCreateSection`），输入分类
名后会在源仓库创建 `site/docs/<分类名>/index.md`，校验不能跟 account/relay/analytics
或已存在分类重名。构建期 `scripts/gen-nav.mjs` 会动态扫描 `docs/` 目录下除同步类、
`.vitepress`、`public` 外的所有子目录作为自定义分类，因此**新分类要等下次
`sync + build + deploy` 后才会出现在网站顶部导航栏**（与新建/删除文档的已知限制
一致），但内容本身在编辑器保存后立即生效于源仓库。

"新建分类"入口除了编辑器侧边栏内部，还在文档站首页和顶部导航栏各加了一个
"＋ 新建分类" 按钮/链接（`site/docs/index.md` 的 hero actions、
`site/docs/.vitepress/config.ts` 的 nav），点击都会跳转到
`/edit/?action=create-section`。编辑器 `App.tsx` 识别到这个 `action` 参数后，
页面挂载时自动触发一次新建分类的输入弹窗（复用侧边栏同一套 `handleCreateSection`
逻辑），不再要求用户必须先进到某篇文档才能发现"新建分类"功能；未选中任何文档时
也会展示一个引导态（而不是"缺少参数"报错），提示用户从左侧选择文档或直接新建分类。

## 已知限制 / 后续可优化方向

- 网页编辑器目前只支持 Markdown 常见富文本元素（标题/列表/加粗/代码块等，基于 Tiptap StarterKit），
  复杂表格、脚注等语法建议直接用代码方式编辑
- 镜像文档中的相对链接（如指向同仓库内图片）暂未做路径重写，如有需要可在
  `scripts/sync-sources.mjs` 中扩展
- 当前 GitHub 写入直接提交到 `main` 分支，未走 PR 审核流程
