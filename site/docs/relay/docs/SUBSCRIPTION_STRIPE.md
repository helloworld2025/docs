# 订阅系统与 Stripe 集成文档

## 目录

- [架构概览](#架构概览)
- [套餐设计](#套餐设计)
- [支付流程](#支付流程)
- [环境配置](#环境配置)
- [Stripe 密钥获取](#stripe-密钥获取)
- [Webhook 配置](#webhook-配置)
- [本地开发调试](#本地开发调试)
- [数据库 sqlx 缓存更新](#数据库-sqlx-缓存更新)
- [部署说明](#部署说明)

---

## 架构概览

```
用户点击升级
    │
    ▼
web /subscription 页面
    │  调用 POST /subscription/checkout
    ▼
server（用 STRIPE_SECRET_KEY 创建 Checkout Session）
    │  返回 { url: "https://checkout.stripe.com/..." }
    ▼
用户跳转到 Stripe 托管结账页面（输卡、支付）
    │
    ├─ 成功 → 跳回 /subscription/success
    └─ 取消 → 跳回 /subscription/cancel
             │
             │（异步）Stripe Webhook
             ▼
    POST /webhook/stripe（server 验证签名 + 更新数据库）
```

> **关键设计**：使用 Stripe 托管 Checkout（redirect 模式），前端不需要 Stripe.js，
> 不需要 publishable key，只需后端的 secret key。

---

## 套餐设计

| 套餐 | 标识 | 特点 |
|------|------|------|
| Starter | `starter` | 免费，有月请求限额（admin 配置） |
| Pro | `pro` | 付费，有月请求限额（比 Starter 高） |
| Unlimited | `unlimited` | 付费，无限次请求 |

**计费逻辑**：
- 每次调用 AI 接口时，在 `auth/middleware.rs` 里检查 `user_subscriptions` 表
- Starter/Pro 超过 `requests_limit` 后拒绝请求（返回 429）
- Unlimited 直接放行（不计数）
- 白名单用户（`allowed_users`）不走订阅检查

---

## 支付流程

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/subscription/status` | 查询当前用户订阅状态 |
| `POST` | `/subscription/checkout` | 创建 Stripe Checkout Session |
| `POST` | `/subscription/portal` | 创建 Stripe Customer Portal（管理/取消订阅） |
| `POST` | `/webhook/stripe` | Stripe Webhook 回调（验签 + 更新 DB） |

### Webhook 事件处理

| 事件 | 处理逻辑 |
|------|----------|
| `checkout.session.completed` | 首次支付成功，写入/更新 `user_subscriptions` |
| `customer.subscription.updated` | 套餐变更（升降级、续费） |
| `customer.subscription.deleted` | 取消订阅，降回 Starter |
| `invoice.payment_failed` | 续费失败，标记 `plan_status = 'past_due'` |

---

## 环境配置

### server/.env（本地开发 / test1）

```env
# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Price IDs（在 Stripe Dashboard 创建的价格）
STRIPE_PRO_PRICE_ID_MONTHLY=price_xxx
STRIPE_PRO_PRICE_ID_YEARLY=price_xxx
STRIPE_UNLIMITED_PRICE_ID_MONTHLY=price_xxx
STRIPE_UNLIMITED_PRICE_ID_YEARLY=price_xxx

# 订阅成功/取消跳回的前端地址
APP_BASE_URL=https://test1.relay.tech
```

### GCE 远端 ~/relay/.env.test（test1/test2 环境）

在服务器上**手动一次性配置**，deploy 不会自动覆盖这些值：

```bash
# SSH 到 relay-test
gcloud compute ssh relay-test --zone=asia-east1-b --project=relay-498604

# 编辑 .env.test
nano ~/relay/.env.test
```

需要追加：

```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRO_PRICE_ID_MONTHLY=price_xxx
STRIPE_PRO_PRICE_ID_YEARLY=price_xxx
STRIPE_UNLIMITED_PRICE_ID_MONTHLY=price_xxx
STRIPE_UNLIMITED_PRICE_ID_YEARLY=price_xxx
APP_BASE_URL_TEST1=https://test1.relay.tech
APP_BASE_URL_TEST2=https://test2.relay.tech
```

### GCP Secret Manager（pro 环境）

为生产环境在 Secret Manager 中创建对应 secret：

```bash
echo -n "sk_live_xxx" | gcloud secrets create relay-stripe-secret-key --data-file=-
echo -n "whsec_xxx"   | gcloud secrets create relay-stripe-webhook-secret --data-file=-
# ... 其他 price id secrets
```

然后在 `deploy.js` 的 `deployServerCloudRun` 的 `optionalCandidates` 里添加映射。

---

## Stripe 密钥获取

### STRIPE_SECRET_KEY

前往 [Stripe Dashboard → Developers → API keys](https://dashboard.stripe.com/apikeys)

| 环境 | 前缀 | Dashboard 切换 |
|------|------|----------------|
| Test | `sk_test_xxx` | 右上角开启 **Test mode** |
| Live | `sk_live_xxx` | 右上角关闭 Test mode |

### Price ID

前往 [Stripe Dashboard → Products](https://dashboard.stripe.com/products)，
创建 Pro / Unlimited 两个产品，每个产品分别创建月付 / 年付两个价格。
每个价格有唯一的 `price_xxx` ID。

> **注意**：Test 环境和 Live 环境的 Price ID 不同，各自独立。

### STRIPE_WEBHOOK_SECRET（whsec_xxx）

有两种来源，值不同：

**本地开发（临时，每次启动 CLI 不变）：**

```bash
stripe listen --forward-to localhost:8000/webhook/stripe
# CLI 输出：Ready! Your webhook signing secret is whsec_xxx
```

**生产/test1 部署（永久）：**

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
2. 填入端点 URL：`https://api-test1.relay.tech/webhook/stripe`
3. 勾选事件：`checkout.session.completed` / `customer.subscription.updated` /
   `customer.subscription.deleted` / `invoice.payment_failed`
4. 创建后点 **Signing secret → Reveal** 复制 `whsec_xxx`

> test1 和 pro 需要分别创建 webhook endpoint，各自有独立的 `whsec_xxx`。

---

## 本地开发调试

```bash
# 终端 1：启动本地 postgres
cd server && docker compose up db

# 终端 2：启动 Rust server
cd server && cargo run

# 终端 3：转发 Stripe webhook 到本地
stripe listen --forward-to localhost:8000/webhook/stripe

# 测试支付（Stripe 测试卡号）
# 卡号：4242 4242 4242 4242
# 到期：任意未来日期
# CVV：任意 3 位
```

---

## 数据库 sqlx 缓存更新

sqlx 在编译期检查 SQL 语法，需要连接数据库或使用离线缓存（`.sqlx/` 目录）。

**deploy.js 已配置 `SQLX_OFFLINE=true`**，编译时使用缓存，不需要数据库连接。

### 何时需要更新缓存

每次**修改了 `sqlx::query!()` 中的 SQL 语句**后，必须重新生成缓存：

```bash
# 1. 确保本地 postgres 在运行
cd server && docker compose up -d db

# 2. 生成缓存（在 server/ 目录下执行）
cd server && cargo sqlx prepare

# 3. 提交缓存文件
git add server/.sqlx/
git commit -m "chore: update sqlx cache"
```

> **新增 migration 后也需要更新缓存**，因为新表/列的类型信息会变化。

### 缓存文件位置

```
server/.sqlx/
└── query-<hash>.json   # 每条 sqlx::query!() 对应一个文件
```

这些文件已纳入 git 版本管理（不在 `.gitignore` 中），确保 CI/CD 构建无需数据库。

---

## 部署说明

### 一键部署 test1（全量）

```bash
node deploy.js test1
```

### 单独部署各服务

```bash
node deploy.js test1 --web     # 只部署 web（Cloudflare Workers）
node deploy.js test1 --admin   # 只部署 admin（Cloudflare Pages）
node deploy.js test1 --server  # 只部署 server（GCE docker compose）
```

### deploy.js 对 server 的处理流程

1. 读取本地 `server/.env` 的 `DATABASE_URL`（仅用于 sqlx 编译时验证）
2. `cargo zigbuild --release --target x86_64-unknown-linux-gnu`（`SQLX_OFFLINE=true`）
3. `docker build` → `docker push` 到 GCP Artifact Registry
4. SSH 到 GCE `relay-test`，更新远端 `.env.test` 中的：
   - `IMAGE_TEST1`（新镜像 tag）
   - `CORS_ALLOWED_ORIGINS`
   - `APP_BASE_URL_TEST1`
5. `docker compose pull` + `up -d` 滚动重启
6. 自动执行 `sqlx migrate run`（应用新 migration）
