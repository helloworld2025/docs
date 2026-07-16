# Relay SSO — 业务系统接入文档

**OIDC / OAuth 2.0 认证服务**  
Base URL: `https://account.relay.tech`

---

## 目录

1. [接入概览](#1-接入概览)
2. [注册 Client](#2-注册-client)
3. [授权流程](#3-授权流程)
4. [换取 Token](#4-换取-token)
5. [Token 本地验证](#5-token-本地验证)
6. [获取用户信息](#6-获取用户信息)
7. [刷新 Token](#7-刷新-token)
8. [注销登录](#8-注销登录)
9. [吊销 Token](#9-吊销-token)
10. [接入方数据架构建议](#10-接入方数据架构建议)
11. [各语言接入示例](#11-各语言接入示例)
12. [安全机制说明](#12-安全机制说明)
13. [错误码参考](#13-错误码参考)

---

## 1. 接入概览

Relay SSO 实现了标准 OIDC Authorization Code Flow，支持 **PKCE** 和客户端密钥两种方式。

### 端点自动发现

所有端点信息通过标准 OIDC Discovery 自动暴露：

```
GET https://account.relay.tech/.well-known/openid-configuration
```

大多数 OAuth 库（NextAuth、Passport.js、Spring Security 等）可直接用此 URL 自动配置。

### 主要端点

| 端点 | 地址 |
|------|------|
| 授权 | `GET  /authorize` |
| 换 Token | `POST /token` |
| 用户信息（读） | `GET  /userinfo` |
| 用户信息（写） | `PATCH /userinfo` |
| 刷新 Token | `POST /token` (grant_type=refresh_token) |
| 吊销 Token | `POST /revoke` |
| 注销 | `GET  /logout` |
| 公钥 | `GET  /.well-known/jwks.json` |

### 选择 Client 类型

| 场景 | 推荐类型 | 认证方式 |
|------|---------|---------|
| 有服务端的 Web 应用（Next.js SSR、Go、Python） | `confidential` | client_secret |
| 纯前端 SPA（React/Vue 直接调用） | `public` | PKCE (S256) |
| 移动端 App（iOS/Android） | `public` | PKCE (S256) |
| 内部工具 / 管理系统 | 任意 + `is_first_party=1` | 同上 |

---

## 2. 注册 Client

在 [Admin 面板](https://admin.relay.tech) → **Clients** → **New Client** 创建：

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 应用名称 | `My App` |
| `client_id` | 唯一标识（自定义） | `my-app` |
| `type` | `public` 或 `confidential` | `confidential` |
| `redirect_uris` | 回调地址白名单（精确匹配） | `["https://app.example.com/auth/callback"]` |
| `allowed_scopes` | 允许申请的 scope | `openid email profile offline_access` |
| `is_first_party` | 内部应用（跳过 consent 页面） | `true` |

> ⚠️ `client_secret` 仅在创建时显示一次，请立即保存。

---

## 3. 授权流程

### 3a. Public Client（必须使用 PKCE）

**Step 1：生成 PKCE 参数**

```javascript
// 生成 code_verifier（存入 sessionStorage/内存，不要发送给任何人）
const array = new Uint8Array(64);
crypto.getRandomValues(array);
const verifier = btoa(String.fromCharCode(...array))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

// 计算 code_challenge = BASE64URL(SHA256(verifier))
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
```

**Step 2：跳转授权页**

```
GET https://account.relay.tech/authorize
  ?client_id=my-spa
  &redirect_uri=https://app.example.com/callback
  &response_type=code
  &scope=openid%20email%20profile
  &state=RANDOM_CSRF_TOKEN
  &code_challenge=<challenge>
  &code_challenge_method=S256
```

**Step 3：处理回调**

```
GET https://app.example.com/callback
  ?code=AUTH_CODE
  &state=RANDOM_CSRF_TOKEN   ← 验证与发送时一致
```

---

### 3b. Confidential Client（服务端）

**Step 1：跳转授权页**（无需 PKCE，但建议加上）

```
GET https://account.relay.tech/authorize
  ?client_id=my-server-app
  &redirect_uri=https://app.example.com/auth/callback
  &response_type=code
  &scope=openid%20email%20profile%20offline_access
  &state=RANDOM_CSRF_TOKEN
  &nonce=RANDOM_NONCE
```

**Step 2：处理回调**（同 public client）

---

## 4. 换取 Token

### Public Client

```http
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTH_CODE
&redirect_uri=https://app.example.com/callback
&client_id=my-spa
&code_verifier=VERIFIER_FROM_STEP_1
```

### Confidential Client

```http
POST /token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code
&code=AUTH_CODE
&redirect_uri=https://app.example.com/auth/callback
```

或 POST body 方式：

```http
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTH_CODE
&redirect_uri=https://app.example.com/auth/callback
&client_id=my-server-app
&client_secret=YOUR_CLIENT_SECRET
```

### 响应

```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "XYZ...",
  "token_type": "Bearer",
  "expires_in": 28800,
  "scope": "openid email profile offline_access"
}
```

| 字段 | 说明 | 有效期 |
|------|------|--------|
| `access_token` | 调用 API 用 | 8 小时 |
| `id_token` | 用户身份信息（JWT） | 8 小时 |
| `refresh_token` | 换新 access_token 用（需要 `offline_access` scope） | 90 天，滑动窗口（每次使用自动续期） |

---

## 5. Token 本地验证

业务服务端可以**本地验证** access_token，无需调用 SSO（减少延迟）。

### 算法

- 签名算法：`ES256`（ECDSA P-256）
- 公钥地址：`https://account.relay.tech/.well-known/jwks.json`（建议缓存 1 小时）

### 必须验证的字段

| 字段 | 预期值 |
|------|--------|
| `alg` | `ES256` |
| `iss` | `https://account.relay.tech` |
| `aud` | 你的 `client_id` |
| `exp` | 大于当前时间戳 |
| `token_use` | `access` |

### Node.js 示例

```javascript
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(
  new URL('https://account.relay.tech/.well-known/jwks.json')
);

async function verifyToken(accessToken, clientId) {
  const { payload } = await jwtVerify(accessToken, JWKS, {
    issuer: 'https://account.relay.tech',
    audience: clientId,       // 必须验证 aud
    algorithms: ['ES256'],
  });

  if (payload.token_use !== 'access') throw new Error('Not an access token');
  return payload;
}
```

### id_token 的字段

```json
{
  "iss": "https://account.relay.tech",
  "sub": "user_uuid",
  "aud": "my-client-id",
  "iat": 1700000000,
  "exp": 1700000900,
  "token_use": "id",
  "email": "user@example.com",
  "email_verified": true,
  "name": "Display Name",
  "picture": "https://..."
}
```

> `email`、`name`、`picture` 仅在请求了对应 scope 时返回。

---

## 6. 用户信息（读 / 写）

当不方便本地验证 JWT 时，可调用 userinfo 端点：

```http
GET /userinfo
Authorization: Bearer ACCESS_TOKEN
```

**响应：**

```json
{
  "sub": "user_uuid",
  "email": "user@example.com",
  "email_verified": true,
  "name": "Display Name",
  "picture": "https://..."
}
```

### 更新用户 Profile（PATCH /userinfo）

业务系统可以通过 access token 更新用户的 `name` 和 `picture`，Account 是唯一的写入点。

**要求**：access token 的 `scope` 必须包含 `profile`。

```http
PATCH /userinfo
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json

{
  "name": "Robin",
  "picture": "https://example.com/avatar.png"
}
```

**响应：**

```json
{
  "sub": "usr_xxxxxxxxxxxx",
  "name": "Robin",
  "picture": "https://example.com/avatar.png"
}
```

| 字段 | 约束 |
|------|------|
| `name` | 最长 200 字符，传 `null` 清空 |
| `picture` | 最长 2048 字符（URL），传 `null` 清空 |

> 不提供的字段不会被修改，只更新显式传入的字段。

---

## 7. 刷新 Token

refresh_token 每次使用后**自动轮换**（旧 token 立即失效），收到新 token 后需更新存储。

```http
POST /token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)   ← confidential client

grant_type=refresh_token
&refresh_token=OLD_REFRESH_TOKEN
```

**响应**与初次换 token 相同，包含新的 `access_token` 和 `refresh_token`。

> ⚠️ 如果检测到 refresh_token **重放**（已撤销的 token 再次使用），该用户在该客户端的**所有 token 立即失效**，需重新登录。

---

## 8. 注销登录

注销 SSO 会话（清除浏览器 Cookie）：

```
GET https://account.relay.tech/logout
```

> 注意：`post_logout_redirect_uri` 参数支持跳回原站，但目标 URL 必须与该 client 的 `redirect_uris` 同域（origin 匹配）。跨域地址将被忽略，以防止开放重定向攻击。

---

## 9. 吊销 Token

立即吊销 refresh_token（同时吊销该用户在该客户端的全部关联 token）：

```http
POST /revoke
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

token=REFRESH_TOKEN
```

无论 token 是否存在，始终返回 `HTTP 200`（符合 RFC 7009）。

---

## 10. 接入方数据架构建议

### 接入方需要自己管理 Token 吗？

**不需要。** Relay 负责颁发、刷新、吊销所有 Token，接入方只需在回调时用一次 code 换 token，后续凭 `id_token` 或 `sub` 识别用户即可。

典型的 Web 应用接入方后端处理逻辑（伪代码）：

```
收到 /callback?code=xxx
  → POST /token 换取 id_token
  → 验证 id_token 签名（见第 5 节）
  → 取出 sub（用户唯一 ID）
  → 写入/查询自己的 users 表（首次自动注册）
  → 生成自己的 session cookie（httpOnly）
  → 重定向到首页
```

之后的所有请求只依赖自己的 session cookie，**不需要**每次都调用 Relay 的 `/userinfo`。

---

### 接入方需要自己的 User 表吗？

**取决于是否有业务数据。**

#### 情况 A：纯认证，无业务数据 → 不需要

如果只需要「知道当前是谁」，不存储用户相关业务数据：

```
用户登录 → 解析 id_token → 取 sub + email → 直接用于业务逻辑
```

适合：内部工具、只读看板、无状态 API。

#### 情况 B：有业务数据 → 需要，但极简

大多数应用需要关联业务数据（帖子、订单、配置…），只需一张极简的 users 表：

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,  -- 直接用 relay 返回的 sub（如 usr_xxxxx）
  email      TEXT NOT NULL,     -- 从 id_token 冗余一份，方便查询/显示
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
  -- 不需要: password_hash, email_verified, avatar... 由 relay 负责
);

-- 首次登录时 upsert
INSERT INTO users (id, email) VALUES (?, ?)
  ON CONFLICT(id) DO UPDATE SET email = excluded.email;
```

业务数据表通过 `user_id` 外键关联即可，**不需要重复存储密码、邮箱验证状态、头像**等由 Relay 统一管理的字段。

#### 职责划分

| | Relay（account.relay.tech） | 接入方 |
|--|--|--|
| 存储 | email、password_hash、name、picture、社交身份、session、审计日志 | `sub → 业务数据` 的映射 |
| 负责 | **认证**（你是谁） | **授权**（你能做什么） |
| 修改 name/picture | ✅ 唯一写入点（`PATCH /userinfo`） | ❌ 只读（调 `/userinfo` 获取） |
| User 表 | ✅ 完整 | ✅ 仅含 `id + email`（按需扩展） |

> 💡 Relay 的 `sub`（用户唯一 ID，格式 `usr_xxxxxxxxxxxx`）就是接入方 users 表的主键，也是所有业务数据的外键锚点。

---

## 11. 各语言接入示例

### Next.js（使用 next-auth）

```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';

export const { handlers, auth } = NextAuth({
  providers: [{
    id: 'relay',
    name: 'Relay SSO',
    type: 'oidc',
    issuer: 'https://account.relay.tech',
    clientId: process.env.RELAY_CLIENT_ID,
    clientSecret: process.env.RELAY_CLIENT_SECRET,
  }],
});
```

### Go（使用 coreos/go-oidc）

```go
provider, _ := oidc.NewProvider(ctx, "https://account.relay.tech")

oauth2Config := &oauth2.Config{
    ClientID:     os.Getenv("RELAY_CLIENT_ID"),
    ClientSecret: os.Getenv("RELAY_CLIENT_SECRET"),
    RedirectURL:  "https://app.example.com/callback",
    Endpoint:     provider.Endpoint(),
    Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
}
```

### Python（使用 authlib）

```python
from authlib.integrations.flask_client import OAuth

oauth = OAuth(app)
oauth.register(
    name='relay',
    server_metadata_url='https://account.relay.tech/.well-known/openid-configuration',
    client_id=os.environ['RELAY_CLIENT_ID'],
    client_secret=os.environ['RELAY_CLIENT_SECRET'],
    client_kwargs={'scope': 'openid email profile'},
)
```

---

## 12. 安全机制说明

### PKCE（public client 必须，S256 唯一合法值）

防止授权码劫持。plain 方法被明确拒绝：

```
error: invalid_request
error_description: code_challenge_method must be S256
```

### 授权码安全

- 60 秒过期
- 一次性使用（Peek-then-Consume 原子操作，防止竞态）
- 严格匹配 `redirect_uri` 和 `client_id`

### Refresh Token 轮换

每次刷新生成新 token，旧 token 立即吊销。检测到重放时，整个 token 家族全部失效。

### 密码存储

PBKDF2-HMAC-SHA256，随机 salt，时序安全比较（防 timing attack）。

### JWT 签名

ES256（ECDSA P-256），服务端私钥签名，公钥通过 JWKS 端点发布。

---

## 13. 错误码参考

| error | HTTP | 含义 |
|-------|------|------|
| `invalid_client` | 401 | client_id 不存在或 secret 错误 |
| `invalid_grant` | 400 | code 无效/过期/已使用，或 PKCE 不匹配 |
| `invalid_request` | 400 | 缺少必要参数（如 code_challenge） |
| `invalid_scope` | 400 | 请求了未授权的 scope |
| `unsupported_grant_type` | 400 | 仅支持 `authorization_code` 和 `refresh_token` |
| `unsupported_response_type` | 400 | 仅支持 `code` |
| `unauthorized_client` | 400 | client 未注册或 redirect_uri 不在白名单 |
| `invalid_token` | 401 | access_token 无效或过期（userinfo 端点） |
| `access_denied` | — | 用户在 consent 页面拒绝授权 |
