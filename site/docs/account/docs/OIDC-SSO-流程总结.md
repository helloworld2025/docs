# OIDC SSO 完整流程总结

> 基于源码分析（`server/src/routes/` + `server/src/lib/`），记录本系统的 OIDC 授权码流完整实现及接入方操作手册。

---

## 一、服务端端点总览（Discovery 文档）

访问 `GET /.well-known/openid-configuration` 可获得所有端点：

| 端点 | URL |
|------|-----|
| 授权端点 | `{ISSUER}/authorize` |
| Token 端点 | `{ISSUER}/token` |
| UserInfo 端点 | `{ISSUER}/userinfo` |
| JWKS 端点 | `{ISSUER}/.well-known/jwks.json` |
| 吊销端点 | `{ISSUER}/revoke` |
| 登出端点 | `{ISSUER}/logout` |

**协议能力声明：**

- 签名算法：**ES256**（椭圆曲线 P-256）
- 支持 Scopes：`openid`, `profile`, `email`, `offline_access`
- 支持 response_type：`code`（仅授权码流）
- 支持 grant_type：`authorization_code`, `refresh_token`
- PKCE：公开客户端**强制要求** S256，机密客户端可选但若使用也必须 S256
- 不支持 JAR（`request` / `request_uri` 参数），防止 SSRF

---

## 二、完整 OIDC 授权码流程（SSO 主流程）

```
接入方 APP                    IdP Server                    用户浏览器
    │                              │                              │
    │ ① 构造授权请求 URL            │                              │
    │──────────────────────────────────────────────────────────►│
    │    GET /authorize?           │                              │
    │      client_id=...           │                              │
    │      redirect_uri=...        │                              │
    │      response_type=code      │                              │
    │      scope=openid profile email offline_access             │
    │      state=xxx               │                              │
    │      nonce=yyy               │                              │
    │      code_challenge=zzz      │                              │
    │      code_challenge_method=S256                            │
    │                              │                              │
    │                              │ ② 验证 client_id + redirect_uri
    │                              │◄─────────────────────────────│
    │                              │                              │
    │                              │ ③ 检查 SSO Cookie (account)  │
    │                              │◄─────────────────────────────│
    │                              │                              │
    │             [用户未登录]      │                              │
    │                              │ ④ 跳转 /login?{原始参数}     │
    │                              │──────────────────────────────►│
    │                              │                              │
    │                              │ ⑤ 用户完成认证               │
    │                              │   (密码/OTP注册/社交登录)     │
    │                              │◄─────────────────────────────│
    │                              │                              │
    │                              │ ⑥ 创建 SSO Session           │
    │                              │   (D1 写入 + KV 缓存)        │
    │                              │   Cookie: account=sid_xxx    │
    │                              │                              │
    │             [用户已登录]      │                              │
    │                              │ ⑦ 第一方客户端：直接签发授权码 │
    │                              │   第三方客户端：检查 consent  │
    │                              │   (已记录 → 跳过 Consent 页)  │
    │                              │                              │
    │                              │ ⑧ 生成 auth_code（TTL 60秒） │
    │                              │   写入 D1 auth_codes 表      │
    │                              │                              │
    │                              │ ⑨ 302 重定向回 redirect_uri  │
    │◄──────────────────────────────────────────────────────────│
    │  ?code=xxx&state=xxx&iss={ISSUER}                         │
    │                              │                              │
    │ ⑩ 服务端 POST /token         │                              │
    │──────────────────────────────►│                             │
    │  grant_type=authorization_code                             │
    │  code=xxx                    │                              │
    │  redirect_uri=...            │                              │
    │  code_verifier=...（PKCE）   │                              │
    │  client_id / client_secret   │                              │
    │                              │                              │
    │                              │ ⑪ 验证 client 身份 + code    │
    │                              │   + redirect_uri + PKCE      │
    │                              │   + 用户状态（active）        │
    │                              │                              │
    │                              │ ⑫ 原子消费 code（防并发重放） │
    │                              │                              │
    │                              │ ⑬ 签发 Token Set             │
    │◄─────────────────────────────│                             │
    │  {                           │                              │
    │    access_token (JWT, 8h)    │                              │
    │    id_token    (JWT, 8h)     │                              │
    │    refresh_token (90天,可选) │                              │
    │    token_type: "Bearer"      │                              │
    │    expires_in: 28800         │                              │
    │  }                           │                              │
```

---

## 三、关键流程细节

### 3.1 用户认证方式

#### 方式 A：邮箱 + 密码（两步式）

1. `GET /login` → 显示邮箱输入页（含 Cloudflare Turnstile 人机验证）
2. `POST /login/check` → 检查邮箱是否已存在
   - 已有账号 → 跳转密码输入页
   - 纯社交账号（无密码）→ 提示使用对应社交登录
   - 新邮箱 → 发送 6 位 OTP 验证码到邮箱，跳转注册页
3. `POST /login` → 验证密码，通过后建立 SSO Session
4. `POST /register` → 验证 OTP + 设置密码 → 创建账号并建立 SSO Session

#### 方式 B：社交登录（Google / GitHub / Apple）

1. `GET /social/{provider}/start`
   - 生成 CSRF token，将原始 OIDC 参数编码进 state
   - state 结构：`base64url(JSON{ csrf, authQuery })`
   - 跳转到第三方 OAuth 授权页
2. `GET /social/{provider}/callback`（Apple 用 POST form_post）
   - 验证 state + CSRF cookie，防止 CSRF 攻击
   - 兑换 token，获取用户 profile
   - 查找或创建本地账号（按 provider_uid 或邮箱匹配）
   - 建立 SSO Session，跳回 `/authorize?{原始参数}` 完成 OIDC 流程

#### 方式 C：忘记密码（OTP 重置）

1. `GET /forgot` + `POST /forgot/send` → 发送 6 位 OTP 到邮箱（TTL 5分钟）
2. `POST /reset` → 验证 OTP + 设置新密码 → 自动建立 Session

---

### 3.2 SSO Session 机制

| 属性 | 值 |
|------|-----|
| Cookie 名称 | `account` |
| Cookie 属性 | httpOnly, secure, SameSite=Lax |
| 有效期（记住我） | **30 天** |
| 有效期（不记住我） | **4 小时** |
| 存储 | D1（`sso_sessions` 表，source of truth）+ KV（`sess:{id}` 快速缓存） |
| KV 缓存内容 | 用户 profile（**不含** password_hash，存 has_password 布尔值） |

**Session 查找逻辑：**
1. 优先读 KV 缓存（大多数请求无需查 D1）
2. KV miss → 查 D1 `sso_sessions` 表，读 user 信息，异步回填 KV

---

### 3.3 授权码（auth_code）

- 随机 32 字节 token（`randomToken(32)`）
- TTL：**60 秒**（极短，防止泄漏或重放）
- 存储：D1 `auth_codes` 表
- 消费策略：**先 peek 验证（非破坏性），后原子 consume**（`consumed = 1`），防并发重放
- 响应中额外携带 `iss` 参数（RFC 9207，防多 IdP 混淆攻击）

---

### 3.4 第三方客户端授权同意（Consent）

- `is_first_party = 1` 的客户端**直接跳过** Consent 页
- 第三方客户端首次授权时展示 Consent 页，列出 scope 清单
- 用户同意后，授权记录写入 `user_consents` 表（upsert 语义）
- 后续再次授权且 scope 集合未扩大时，**自动跳过** Consent 页
- 如客户端新增了 scope，下次登录将重新触发 Consent 页

---

### 3.5 Token 内容

#### access_token（JWT，ES256，8 小时）

```json
{
  "iss": "{ISSUER}",
  "sub": "usr_xxxxx",
  "aud": "{client_id}",
  "scope": "openid profile email offline_access",
  "token_use": "access",
  "client_id": "{client_id}",
  "email": "user@example.com",   // 仅当 scope 包含 email
  "iat": 1700000000,
  "exp": 1700028800
}
```

#### id_token（JWT，ES256，8 小时）

```json
{
  "iss": "{ISSUER}",
  "sub": "usr_xxxxx",
  "aud": "{client_id}",
  "token_use": "id",
  "nonce": "yyy",                // 当请求时携带 nonce
  "email": "user@example.com",   // scope: email
  "email_verified": true,        // scope: email
  "name": "张三",                // scope: profile
  "picture": "https://...",      // scope: profile
  "iat": 1700000000,
  "exp": 1700028800
}
```

---

### 3.6 Refresh Token 轮换机制

| 属性 | 值 |
|------|-----|
| 获取条件 | scope 中包含 `offline_access` |
| 有效期 | **90 天**（滑动：每次轮换后重置） |
| 存储 | D1 `refresh_tokens` 表（存 SHA-256(token)，**不存明文**） |
| 轮换策略 | **Refresh Token Rotation**：每次刷新签发新 token，旧 token 标记 `revoked=1` |
| 重放检测 | 已轮换的旧 token 被使用 → 立即吊销该用户+该客户端**所有** token，写审计日志 `token.refresh_replay` |

---

### 3.7 UserInfo 端点

```http
GET {ISSUER}/userinfo
Authorization: Bearer {access_token}
```

响应内容由 access_token 中的 scope 决定：

```json
{
  "sub": "usr_xxxxx",
  "email": "user@example.com",   // scope: email
  "email_verified": true,        // scope: email
  "name": "张三",                // scope: profile
  "picture": "https://..."       // scope: profile
}
```

支持 `PATCH /userinfo`（需 profile scope）更新 name / picture 字段。

---

### 3.8 登出流程（RP-Initiated Logout）

```
GET {ISSUER}/logout?post_logout_redirect_uri=https://yourapp.com/logged-out
```

- 删除 D1 `sso_sessions` 记录 + 删除 KV 缓存 + 清除 `account` Cookie
- `post_logout_redirect_uri`：
  - **必须**与任一已注册 OAuth 客户端的 redirect_uri **同源**才会跳转
  - 不满足条件则显示"已登出"提示页

---

### 3.9 Token 吊销（RFC 7009）

```http
POST {ISSUER}/revoke
Content-Type: application/x-www-form-urlencoded
Authorization: Basic {base64(client_id:client_secret)}  # 或 POST body

token={refresh_token}
```

- 吊销该用户+客户端的**整个 token 家族**（所有相关 refresh_token 标记 revoked）
- 遵循 RFC 7009 §2.2：**无论 token 是否存在，均返回 HTTP 200**
- 支持 Basic Auth 或 POST body 两种客户端认证方式

---

## 四、接入方（RP）操作手册

### Step 1：注册 OAuth 客户端

通过 Admin 控制台创建客户端，需提供：

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 应用展示名称（显示在 Consent 页） | `"我的应用"` |
| `type` | 客户端类型 | `"public"` 或 `"confidential"` |
| `redirect_uris` | 精确匹配的回调 URL 列表 | `["https://yourapp.com/callback"]` |
| `allowed_scopes` | 允许申请的 scope | `"openid profile email offline_access"` |
| `is_first_party` | 是否跳过 Consent 页 | `0`（第三方）或 `1`（第一方） |

**创建后获得：**
- `client_id`（所有客户端都有）
- `client_secret`（仅 confidential 客户端）

**客户端类型选择：**
- `public`：纯前端 SPA、Native App、无法保密 secret 的场景 → **必须使用 PKCE**
- `confidential`：有服务器端后端的 Web 应用 → 使用 client_secret 认证，PKCE 可选

---

### Step 2：构造授权请求

将用户浏览器重定向至：

```
GET {ISSUER}/authorize
  ?client_id={your_client_id}
  &redirect_uri={your_callback_url}       ← 必须在注册的列表中
  &response_type=code
  &scope=openid profile email offline_access
  &state={随机不可猜测的值}               ← 防 CSRF，存入 session 备验证
  &nonce={随机值}                         ← 防 id_token 重放，存入 session 备验证
  &code_challenge={BASE64URL(SHA-256(code_verifier))}   ← 公开客户端必须
  &code_challenge_method=S256                            ← 公开客户端必须
```

**生成 PKCE 参数（公开客户端）：**

```javascript
// 生成 code_verifier（推荐 64 字节随机字符串）
function generateCodeVerifier() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

// 生成 code_challenge
async function generateCodeChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64urlEncode(new Uint8Array(digest));
}
```

---

### Step 3：处理回调

用户认证完成后，IdP 跳转回你的 `redirect_uri`：

```
https://yourapp.com/callback
  ?code=abc123
  &state=xxx      ← 必须验证与 Step 2 发出的 state 完全一致
  &iss={ISSUER}   ← 必须验证与期望的 ISSUER 一致（RFC 9207）
```

**安全检查清单：**
1. ✅ 验证 `state` 与 session/cookie 中存储的一致（防 CSRF）
2. ✅ 验证 `iss` 与配置的 ISSUER 一致（防 mix-up 攻击）
3. ✅ 确保 `code` 只使用一次（服务端已做原子消费保证）

---

### Step 4：兑换 Token

在**服务器端**（绝不能在浏览器端）调用：

```http
POST {ISSUER}/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=abc123
&redirect_uri={your_callback_url}        ← 必须与 Step 2 的值完全一致
&client_id={your_client_id}
&client_secret={your_client_secret}      ← confidential 客户端
&code_verifier={原始 code_verifier}      ← 公开客户端
```

**成功响应（HTTP 200）：**

```json
{
  "access_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9...",
  "refresh_token": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "token_type": "Bearer",
  "expires_in": 28800,
  "refresh_token_expires_in": 7776000,
  "scope": "openid profile email offline_access"
}
```

**错误响应（HTTP 400/401）：**

```json
{
  "error": "invalid_grant",
  "error_description": "code expired"
}
```

常见错误码：`invalid_client` / `invalid_grant` / `unsupported_grant_type`

---

### Step 5：验证 id_token

```javascript
// 1. 获取 JWKS（建议缓存 1 小时）
const jwks = await fetch(`${ISSUER}/.well-known/jwks.json`).then(r => r.json());

// 2. 必须验证的项目：
//    ✅ 签名有效（ES256，使用 JWKS 中 kid 匹配的公钥）
//    ✅ iss === {ISSUER}
//    ✅ aud === {your_client_id}（防止接受其他客户端的 token）
//    ✅ exp > now（token 未过期）
//    ✅ nbf <= now（若存在）
//    ✅ nonce === Step 2 中存储的 nonce（防 id_token 重放攻击）
```

推荐使用标准 OIDC/JWT 库（如 `jose`、`openid-client`）完成验证，不要手写。

---

### Step 6：获取用户信息（可选）

```http
GET {ISSUER}/userinfo
Authorization: Bearer {access_token}
```

通常直接从 `id_token` 读取 claims 即可，无需额外调用 userinfo 端点。

---

### Step 7：刷新 Access Token

access_token 有效期 8 小时，到期前用 refresh_token 续期：

```http
POST {ISSUER}/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token={current_refresh_token}
&client_id={your_client_id}
&client_secret={your_client_secret}     ← confidential 客户端
```

> ⚠️ **重要：** 刷新成功后旧 refresh_token **立即失效**，必须将新 refresh_token 持久化。
>
> ⚠️ **安全提醒：** 如果重复使用已轮换的旧 token，服务端会立即吊销该账号在此客户端的**所有** token（重放攻击防护）。

---

### Step 8：登出

**① 吊销 Refresh Token（服务端调用，可选但推荐）：**

```http
POST {ISSUER}/revoke
Content-Type: application/x-www-form-urlencoded

token={refresh_token}&client_id={client_id}&client_secret={client_secret}
```

**② 发起 RP-Initiated Logout（结束用户浏览器 SSO 会话）：**

将用户浏览器重定向至：

```
GET {ISSUER}/logout?post_logout_redirect_uri=https://yourapp.com/logged-out
```

`post_logout_redirect_uri` 必须与已注册的 redirect_uri **同源**，否则跳转到默认"已登出"页面。

---

## 五、安全要点汇总

| 安全机制 | 实现方式 | 防范威胁 |
|----------|----------|----------|
| PKCE（S256） | 公开客户端强制，机密客户端可选 | 授权码截获攻击 |
| State 参数 | 随机不可猜测值，验证回调中的一致性 | CSRF 攻击 |
| Nonce 参数 | 验证 id_token 中的 nonce | id_token 重放攻击 |
| `iss` 参数（RFC 9207） | 每次授权响应携带 issuer | 多 IdP 混淆攻击（mix-up） |
| auth_code TTL | 60 秒极短有效期 | 授权码泄漏与重放 |
| code 原子消费 | peek 验证 + 原子 consume | 并发重放攻击 |
| Refresh Token Rotation | 每次刷新轮换 token | refresh_token 泄漏 |
| 重放检测 | 旧 token 被使用 → 吊销全部 token 家族 | refresh_token 重放攻击 |
| Turnstile 人机验证 | 注册/登录/忘记密码入口 | 机器人批量攻击 |
| 多维度速率限制 | IP + 账号 + 客户端 + 接口 | 暴力破解 |
| 审计日志 | 所有关键操作写入 `audit_log` | 安全事件溯源 |
| 禁用 JAR | `request_parameter_supported: false` | SSRF（Server-Side Request Forgery）|
| CSRF → Social Login | state cookie + payload 双重验证 | 社交登录 CSRF |

---

## 六、数据库表结构速览

| 表名 | 用途 |
|------|------|
| `users` | 用户账号（email, password_hash, status） |
| `identities` | 社交登录绑定（provider + provider_uid → user） |
| `oauth_clients` | 接入方客户端注册信息 |
| `auth_codes` | 授权码（TTL 60s，一次性消费） |
| `refresh_tokens` | 刷新 token（存 hash，支持轮换与吊销） |
| `sso_sessions` | 浏览器 SSO 会话（与 KV 双写） |
| `user_consents` | 用户已授权的 scope 记录 |
| `audit_log` | 所有关键操作的审计日志 |
| `admin_users` | 管理员账号（与 C 端用户完全隔离） |
