# Relay Analytics

完全独立的埋点与数据分析系统，与 `server/`、`admin/`、`web/`、`mac/`、`android/` 平级，
不共享任何代码、不共享账号体系。

## 目录结构

```
analytics/
├── server/           独立 Rust/Axum 后端（事件摄入 + 报表查询 + 独立登录）
├── dashboard/        独立 React 前端看板
├── sdk-js/           Web/Node 客户端 SDK
├── sdk-swift/        macOS/iOS 客户端 SDK
├── sdk-kotlin/       Android 客户端 SDK
├── deploy/           GCE 单实例部署脚本
└── .env.secrets      部署密钥（不提交 git，复制 .env.secrets.example）
```

## 独立账号体系

Analytics 有自己的 `admin_users` 表和 `/auth/login` 接口，与 relay-server /
Admin 面板的账号完全隔离，互不影响：

- Dashboard 登录页 UI 参照 `admin/` 的风格，但提交时打到 `analytics-server`
  自己的 `/auth/login`，不调用 `api.relay.tech`
- Turnstile **site key** 复用 Admin 面板现有的 pro key（同一个 Cloudflare
  Turnstile 应用可以有多个地方共用同一 site key 校验），但 **secret key**
  独立配置在 `analytics/.env.secrets` 里
- 首个管理员账号需要手动生成密码 hash（用 `account/scripts/gen-admin-hash.mjs`）
  后 INSERT 到 analytics 自己的数据库

```bash
# 生成密码 hash
node account/scripts/gen-admin-hash.mjs "YourPassword123"

# 连接 analytics 数据库手动插入
psql "$DATABASE_URL" -c "
INSERT INTO admin_users (id, email, password_hash, role)
VALUES ('admin_1', 'you@relay.tech', '<上面生成的hash>', 'superadmin');
"
```

## 隐私红线

客户端埋点的 `properties` 字段**禁止**包含：
- 语音内容 / 转写文本
- 截图（含 base64）···
- 邮箱全文 / 姓名等 PII

只允许：布尔值、枚举、耗时（ms）、计数、错误码、模型名等结构化元数据。

## 域名规划（仅生产环境）

| 用途 | 域名 |
|---|---|
| Dashboard（前端） | `analytics.relay.tech` |
| Server（后端 API） | `api-analytics.relay.tech` |

## 快速开始（本地开发）

### 1. 启动后端

```bash
cd analytics/server
docker compose up -d          # 启动独立 Postgres（端口 5433）
cp .env.example .env
# 编辑 .env：填入 ADMIN_JWT_SECRET / TURNSTILE_SECRET（留空则本地跳过 Turnstile 校验）
cargo run
# 服务跑在 http://localhost:8100
```

### 2. 启动前端看板

```bash
cd analytics/dashboard
cp .env.example .env
npm install
npm run dev
# 打开 http://localhost:5175
```

### 3. 客户端 SDK 集成示例

**Web (`sdk-js`)**：
```ts
import { initAnalytics, track } from "@relay/analytics-sdk";
initAnalytics({ endpoint: "https://api-analytics.relay.tech", platform: "web" });
track("waitlist_joined", { source: "landing" });
```

**macOS (`sdk-swift`)**：
```swift
AnalyticsClient.shared.configure(endpoint: "https://api-analytics.relay.tech", platform: "mac")
AnalyticsClient.shared.track("voice_request_completed", properties: ["latencyMs": 820])
```

**Android (`sdk-kotlin`)**：
```kotlin
AnalyticsClient.init(context, endpoint = "https://api-analytics.relay.tech", platform = "android")
AnalyticsClient.track("voice_request_completed", mapOf("latencyMs" to 820))
```

## 生产部署

密钥统一放在 `analytics/.env.secrets`（复制 `.env.secrets.example` 并填写），
完全独立于仓库根目录的 `.env.secrets` / `deploy.js` 流程。

```bash
# 一次性初始化 GCE 实例
bash analytics/deploy/setup-server.sh
# 按提示在 Cloudflare DNS 添加 A 记录：api-analytics.relay.tech → <实例IP>

# 部署后端（自动读取 analytics/.env.secrets 生成远程 .env）
bash analytics/deploy/deploy.sh

# 部署前端看板到 Cloudflare Pages
bash analytics/deploy/deploy-dashboard.sh
# 首次部署后需在 Cloudflare Dashboard 为该 Pages 项目挂载自定义域名 analytics.relay.tech
```

## API 概览

```
POST /auth/login                                      公开，Analytics 独立管理员登录
POST /auth/refresh                                     需要 Admin JWT
POST /events/batch                                     公开，客户端埋点上报
GET  /health

GET  /reports/overview?range=7d|30d|90d               需要 Admin JWT
GET  /reports/funnel?steps=a,b,c&range=30d
GET  /reports/retention?range=90d
GET  /reports/timeseries?event_name=&range=&platform=
GET  /reports/events?event_name=&platform=&page=
```
