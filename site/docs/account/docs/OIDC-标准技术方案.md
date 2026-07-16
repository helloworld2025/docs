# OIDC 标准技术方案

> 本文档基于以下标准编写，适用于所有接入标准 OIDC IdP 的应用方：
> - **OpenID Connect Core 1.0**
> - **RFC 6749** — The OAuth 2.0 Authorization Framework
> - **RFC 7636** — PKCE (Proof Key for Code Exchange)
> - **RFC 7009** — Token Revocation
> - **RFC 9207** — Authorization Server Issuer Identification
> - **OpenID Connect Discovery 1.0**
> - **OpenID Connect RP-Initiated Logout 1.0**

---

## 目录

1. [核心概念与角色](#一核心概念与角色)
2. [Discovery 文档](#二discovery-文档)
3. [客户端类型与选择](#三客户端类型与选择)
4. [完整授权码流程（主流程）](#四完整授权码流程主流程)
5. [接入方详细调用流程](#五接入方详细调用流程)
   - [5.1 注册客户端](#51-注册客户端)
   - [5.2 Step 1 — 构造授权请求](#52-step-1--构造授权请求)
   - [5.3 Step 2 — 处理授权回调](#53-step-2--处理授权回调)
   - [5.4 Step 3 — 兑换 Token](#54-step-3--兑换-token)
   - [5.5 Step 4 — 验证 id_token](#55-step-4--验证-id_token)
   - [5.6 Step 5 — 获取用户信息](#56-step-5--获取用户信息)
   - [5.7 Step 6 — 使用 Access Token 调用 API](#57-step-6--使用-access-token-调用-api)
   - [5.8 Step 7 — 刷新 Access Token](#58-step-7--刷新-access-token)
   - [5.9 Step 8 — 退出登录](#59-step-8--退出登录)
6. [Token 规范](#六token-规范)
7. [Scopes 与 Claims](#七scopes-与-claims)
8. [各平台完整代码示例](#八各平台完整代码示例)
9. [错误处理](#九错误处理)
10. [安全检查清单](#十安全检查清单)

---

## 约定

文档中使用以下通用占位符，接入时替换为实际值：

| 占位符 | 说明 |
|--------|------|
| `https://auth.example.com` | IdP（Identity Provider）的域名 |
| `my-app` | 接入方在 IdP 注册的 client_id |
| `my-secret` | confidential 客户端的 client_secret |
| `https://app.example.com/auth/callback` | 接入方的 OAuth 回调地址 |

---

## 一、核心概念与角色

```
┌─────────────────────────────────────────────────────────────────┐
│                      OIDC 生态系统                              │
│                                                                  │
│  ┌──────────────┐     ①授权请求      ┌──────────────────────┐  │
│  │              │ ─────────────────► │                      │  │
│  │  接入方 (RP) │                    │   身份提供方 (IdP)   │  │
│  │ Relying Party│ ◄───────────────── │ Identity Provider    │  │
│  │              │     ②授权码        │ auth.example.com     │  │
│  │              │                    │                      │  │
│  │              │ ─────────────────► │                      │  │
│  │              │   ③换取 Token      │                      │  │
│  │              │ ◄───────────────── │                      │  │
│  └──────┬───────┘                    └──────────────────────┘  │
│         │ ④ Bearer Token                                        │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │  资源服务器  │  验证 JWT 签名，读取 sub/email 等 claims     │
│  │Resource Server│                                              │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

| 角色 | 说明 |
|------|------|
| **IdP**（Identity Provider）| 身份提供方，负责用户认证、颁发 Token |
| **RP**（Relying Party）| 接入方应用，依赖 IdP 完成用户认证 |
| **Resource Server** | 资源服务器，接受 access_token 访问受保护资源 |
| **End User** | 最终用户，在浏览器中完成认证 |

---

## 二、Discovery 文档

所有端点通过标准 Discovery 文档自动发现，**建议在应用初始化时获取并缓存（建议 5 分钟）**。

```
GET https://auth.example.com/.well-known/openid-configuration
```

**响应示例：**

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/authorize",
  "token_endpoint":         "https://auth.example.com/token",
  "userinfo_endpoint":      "https://auth.example.com/userinfo",
  "jwks_uri":               "https://auth.example.com/.well-known/jwks.json",
  "revocation_endpoint":    "https://auth.example.com/revoke",
  "end_session_endpoint":   "https://auth.example.com/logout",

  "response_types_supported":              ["code"],
  "grant_types_supported":                 ["authorization_code", "refresh_token"],
  "subject_types_supported":               ["public"],
  "id_token_signing_alg_values_supported": ["ES256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
  "scopes_supported":  ["openid", "profile", "email", "offline_access"],
  "claims_supported":  ["sub", "iss", "aud", "exp", "iat", "nonce",
                        "email", "email_verified", "name", "picture"],
  "code_challenge_methods_supported": ["S256"],
  "authorization_response_iss_parameter_supported": true,
  "request_parameter_supported":     false,
  "request_uri_parameter_supported": false
}
```

> **建议**：使用 Discovery 文档动态获取端点 URL，而非在代码中硬编码，便于未来 IdP 端点变更时无需修改接入方代码。

---

## 三、客户端类型与选择

| 场景 | 客户端类型 | 认证方式 | PKCE |
|------|-----------|---------|------|
| 纯前端 SPA（React/Vue/Angular） | `public` | 无 secret（`none`） | **必须** |
| Native App（iOS/Android/Desktop） | `public` | 无 secret（`none`） | **必须** |
| 有后端的 Web 应用（Node/Python/Go/Java） | `confidential` | `client_secret_basic` 或 `client_secret_post` | 推荐 |
| 后端服务间调用 | `confidential` | `client_secret_basic` | 推荐 |

**关键规则：**
- `public` 客户端：**禁止**持有 `client_secret`，**必须**使用 PKCE（`code_challenge_method=S256`）
- `confidential` 客户端：使用 `client_secret` 认证；如额外使用 PKCE，`method` 也必须是 `S256`
- 所有客户端都**必须**声明精确的 `redirect_uri` 白名单，不得使用通配符

---

## 四、完整授权码流程（主流程）

```
接入方(RP)              用户浏览器              IdP Server
    │                       │                      │
    │ ①生成 state/nonce/PKCE │                      │
    │──────────────────────►│                      │
    │  重定向到 /authorize   │                      │
    │                       │──────────────────────►│
    │                       │  GET /authorize?...   │
    │                       │                      │ ②验证 client_id
    │                       │                      │   检查 redirect_uri
    │                       │                      │   检查 scope / PKCE
    │                       │                      │
    │                       │◄─────────────────────│
    │                       │   显示登录/注册页面   │
    │                       │                      │
    │                       │──────────────────────►│
    │                       │  用户输入凭证         │
    │                       │                      │ ③认证用户
    │                       │                      │   创建 SSO Session
    │                       │                      │   生成 auth_code（60s）
    │                       │◄─────────────────────│
    │                       │ 302 → redirect_uri   │
    │◄──────────────────────│   ?code=xxx          │
    │   &state=xxx&iss=...  │                      │
    │                       │                      │
    │ ④验证 state + iss     │                      │
    │                       │                      │
    │──────────────────────────────────────────────►│
    │  POST /token                                  │
    │  grant_type=authorization_code                │
    │  code=xxx                                     │
    │  redirect_uri=...                             │
    │  client_id=...                                │
    │  code_verifier=... (PKCE)                     │
    │  [client_secret=... (confidential only)]      │
    │                                               │ ⑤验证 code + PKCE
    │                                               │   验证 client 身份
    │                                               │   消费 code（原子，只能用一次）
    │◄──────────────────────────────────────────────│
    │  {                                            │
    │    access_token  (JWT)                        │
    │    id_token      (JWT)                        │
    │    refresh_token (可选，offline_access)        │
    │    token_type: "Bearer"                       │
    │    expires_in: ...                            │
    │  }                                            │
    │                                               │
    │ ⑥验证 id_token                               │
    │   (签名 + iss + aud + exp + nonce)            │
    │                                               │
    │ ⑦（可选）GET /userinfo                        │
    │──────────────────────────────────────────────►│
    │  Authorization: Bearer {access_token}         │
    │◄──────────────────────────────────────────────│
    │  { sub, email, name, picture, ... }           │
```

---

## 五、接入方详细调用流程

### 5.1 注册客户端

向 IdP 管理员提交以下信息，获得 `client_id`（和 confidential 客户端的 `client_secret`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 应用名称，显示在用户授权确认页 |
| `type` | enum | ✅ | `"public"` 或 `"confidential"` |
| `redirect_uris` | string[] | ✅ | 精确回调 URL 列表，支持多个 |
| `allowed_scopes` | string | ✅ | 空格分隔，如 `"openid profile email offline_access"` |
| `is_first_party` | boolean | ✅ | `true` = 内部应用（可跳过 Consent 确认页），`false` = 第三方应用 |

**注意：**
- `redirect_uri` 必须使用 HTTPS（开发环境允许 `http://localhost`）
- Native App 可使用自定义 URL Scheme，如 `myapp://auth/callback`
- `redirect_uri` 必须精确匹配，不支持正则或通配符

---

### 5.2 Step 1 — 构造授权请求

接入方将用户浏览器重定向到 IdP 授权端点：

```
GET https://auth.example.com/authorize
```

**必填参数：**

| 参数 | 说明 | 示例 |
|------|------|------|
| `client_id` | 注册时获得的客户端 ID | `my-app` |
| `redirect_uri` | 接收授权码的回调地址（必须精确匹配注册值） | `https://app.example.com/auth/callback` |
| `response_type` | 固定值 | `code` |
| `scope` | 空格分隔的权限，必须包含 `openid` | `openid profile email offline_access` |
| `state` | 随机不可猜测的字符串，**防 CSRF** | `K5wBMaXnVj9cLpE2` |

**强烈推荐参数：**

| 参数 | 说明 |
|------|------|
| `nonce` | 随机字符串，防止 id_token 重放攻击，存入 session 备验证 |
| `code_challenge` | PKCE 挑战值，public 客户端**必须** |
| `code_challenge_method` | 固定值 `S256`，public 客户端**必须** |

**完整示例 URL：**

```
https://auth.example.com/authorize
  ?client_id=my-app
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Fcallback
  &response_type=code
  &scope=openid%20profile%20email%20offline_access
  &state=K5wBMaXnVj9cLpE2
  &nonce=Rq7TzH4sNd6mYk1o
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

**生成 PKCE 参数（各语言实现）：**

```javascript
// JavaScript / TypeScript
async function generatePKCE() {
  // Step 1: 生成 code_verifier（推荐 64 字节随机数，转 URL-safe Base64）
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const codeVerifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  // Step 2: code_challenge = BASE64URL(SHA-256(ASCII(code_verifier)))
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  return { codeVerifier, codeChallenge };
}

function randomBase64url(byteLength = 32) {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
```

```swift
// Swift (iOS/macOS)
import CryptoKit
import Security

func generateCodeVerifier() -> String {
    var bytes = [UInt8](repeating: 0, count: 64)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

func generateCodeChallenge(from verifier: String) -> String {
    let hash = SHA256.hash(data: Data(verifier.utf8))
    return Data(hash).base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}
```

```python
# Python
import os, hashlib, base64

def generate_pkce():
    code_verifier = base64.urlsafe_b64encode(os.urandom(64)).rstrip(b'=').decode()
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
    return code_verifier, code_challenge

# 使用
verifier, challenge = generate_pkce()
state = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b'=').decode()
nonce = base64.urlsafe_b64encode(os.urandom(16)).rstrip(b'=').decode()
```

```kotlin
// Android (Kotlin)
import java.security.MessageDigest
import java.security.SecureRandom
import android.util.Base64

fun generateCodeVerifier(): String {
    val bytes = ByteArray(64)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}

fun generateCodeChallenge(verifier: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray())
    return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
}
```

**发起授权请求前，将以下数据保存到安全存储（服务端 Session 或 sessionStorage）：**

```javascript
// 必须在跳转前保存，回调时验证
session.oauth_state         = state;         // CSRF 防护
session.oauth_nonce         = nonce;         // id_token 重放防护
session.pkce_code_verifier  = codeVerifier;  // PKCE 验证
```

---

### 5.3 Step 2 — 处理授权回调

用户完成认证后，IdP 将浏览器重定向到 `redirect_uri`：

**成功回调：**
```
GET https://app.example.com/auth/callback
  ?code=AbCdEfGhIjKlMnOpQrSt
  &state=K5wBMaXnVj9cLpE2
  &iss=https://auth.example.com
```

> `iss` 参数由 IdP 主动附加（RFC 9207），用于防止多 IdP 混淆攻击。

**错误回调：**
```
GET https://app.example.com/auth/callback
  ?error=access_denied
  &error_description=User+denied+authorization
  &state=K5wBMaXnVj9cLpE2
```

**回调处理逻辑（伪代码）：**

```javascript
async function handleCallback(req) {
  const { code, state, iss, error, error_description } = req.query;

  // ① 处理授权错误
  if (error) {
    throw new Error(`Authorization failed: ${error} — ${error_description}`);
  }

  // ② 验证 state（防 CSRF）— 必须做
  const savedState = session.get("oauth_state");
  session.delete("oauth_state");
  if (!state || state !== savedState) {
    throw new Error("State mismatch — possible CSRF attack, reject request");
  }

  // ③ 验证 iss 参数（RFC 9207）— 强烈推荐
  const ISSUER = "https://auth.example.com";
  if (iss && iss !== ISSUER) {
    throw new Error(`Issuer mismatch: expected ${ISSUER}, got ${iss}`);
  }

  // ④ 检查 code 存在
  if (!code) {
    throw new Error("Missing authorization code");
  }

  // ⑤ 取出 PKCE verifier（仅用一次后删除）
  const codeVerifier = session.get("pkce_code_verifier");
  session.delete("pkce_code_verifier");

  // ⑥ 用 code 换 Token（见下一步）
  const tokens = await exchangeCodeForTokens(code, codeVerifier);
  // ...
}
```

---

### 5.4 Step 3 — 兑换 Token

> ⚠️ **confidential 客户端必须在服务器端发起此请求**，`client_secret` 不得出现在浏览器端。
> Public 客户端（SPA / Native）使用 PKCE 保护，可在客户端兑换。

**端点：**

```http
POST https://auth.example.com/token
Content-Type: application/x-www-form-urlencoded
```

**请求参数（authorization_code 授权类型）：**

| 参数 | 说明 | 必填 |
|------|------|------|
| `grant_type` | 固定值 `authorization_code` | ✅ |
| `code` | Step 2 收到的授权码（通常 60 秒内有效，只能使用一次） | ✅ |
| `redirect_uri` | 与 Step 1 完全一致的回调地址 | ✅ |
| `client_id` | 客户端 ID | ✅ |
| `code_verifier` | PKCE 原始随机字符串（public 客户端必须） | public ✅ |
| `client_secret` | 客户端密钥（confidential 客户端，可改用 HTTP Basic Auth） | confidential ✅ |

**示例 1 — Public 客户端（PKCE，无 secret）：**

```bash
curl -X POST https://auth.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=AbCdEfGhIjKlMnOpQrSt" \
  -d "redirect_uri=https://app.example.com/auth/callback" \
  -d "client_id=my-spa-app" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**示例 2 — Confidential 客户端（HTTP Basic Auth）：**

```bash
# Authorization: Basic base64(client_id:client_secret)
curl -X POST https://auth.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'my-app:my-secret' | base64)" \
  -d "grant_type=authorization_code" \
  -d "code=AbCdEfGhIjKlMnOpQrSt" \
  -d "redirect_uri=https://app.example.com/auth/callback" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**示例 3 — Confidential 客户端（POST body）：**

```bash
curl -X POST https://auth.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=AbCdEfGhIjKlMnOpQrSt" \
  -d "redirect_uri=https://app.example.com/auth/callback" \
  -d "client_id=my-app" \
  -d "client_secret=my-secret" \
  -d "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
```

**成功响应（HTTP 200）：**

```json
{
  "access_token":  "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xIn0...",
  "id_token":      "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImtleS0xIn0...",
  "refresh_token": "rt_xxxxxx.yyyyyy",
  "token_type":    "Bearer",
  "expires_in":    3600,
  "refresh_token_expires_in": 2592000,
  "scope": "openid profile email offline_access"
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| `access_token` | 访问令牌（JWT，用于调用 API） |
| `id_token` | 身份令牌（JWT），包含用户身份 claims，**不用于 API 认证** |
| `refresh_token` | 刷新令牌（不透明字符串，仅当 scope 包含 `offline_access` 时返回） |
| `token_type` | 固定 `"Bearer"` |
| `expires_in` | access_token 有效秒数 |
| `refresh_token_expires_in` | refresh_token 有效秒数（各 IdP 不同，常见 30天/90天） |
| `scope` | 实际授权的 scope |

**错误响应（HTTP 400/401）：**

```json
{
  "error": "invalid_grant",
  "error_description": "authorization code has expired"
}
```

---

### 5.5 Step 4 — 验证 id_token

> ⚠️ **必须完整验证 id_token 中的每一项，跳过任何一项验证都可能导致安全漏洞。**

id_token 是 JWT 格式，结构为 `base64url(header).base64url(payload).signature`

**完整验证流程：**

```
① 获取 JWKS 公钥
   GET https://auth.example.com/.well-known/jwks.json
   → 按 header.kid 查找对应公钥
   → 建议将 JWKS 缓存 1 小时（避免每次都请求网络）

② 验证 JWT 签名
   使用 JWKS 中的公钥验证签名（EC P-256 → ES256）
   签名无效则立即拒绝，不再继续验证

③ 验证 header
   alg === "ES256"  ← 必须固定，防止算法混淆攻击（none / HS256 攻击）
   typ === "JWT"

④ 验证 payload（以下每项都必须验证）
   iss === "https://auth.example.com"   ← 完整 URL 匹配，不能只比较域名
   aud === "my-app"                     ← 防止接受其他应用的 Token
   exp > Math.floor(Date.now() / 1000)  ← Token 未过期
   nbf <= now                           ← 如 nbf 字段存在则验证
   nonce === session.oauth_nonce        ← 防重放攻击，完成后删除 session 中的 nonce
```

**代码示例（Node.js，使用 jose 库）：**

```javascript
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER    = "https://auth.example.com";
const CLIENT_ID = "my-app";

// 在模块初始化时创建（内置缓存）
const JWKS = createRemoteJWKSet(
  new URL(`${ISSUER}/.well-known/jwks.json`)
);

async function verifyIdToken(idToken, expectedNonce) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer:     ISSUER,
    audience:   CLIENT_ID,      // 必须验证 aud
    algorithms: ["ES256"],      // 只允许 ES256，防算法混淆
  });

  // 验证 nonce（防 id_token 重放攻击）
  if (payload.nonce !== expectedNonce) {
    throw new Error("Nonce mismatch — replay attack detected");
  }

  return payload;
}

// 使用示例
const nonce = session.get("oauth_nonce");
session.delete("oauth_nonce");
const userClaims = await verifyIdToken(tokens.id_token, nonce);
console.log(userClaims.sub);   // 用户唯一 ID
console.log(userClaims.email); // 用户邮箱
```

**JWKS 响应格式：**

```json
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "x":   "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
      "y":   "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
      "kid": "key-1",
      "alg": "ES256",
      "use": "sig"
    }
  ]
}
```

---

### 5.6 Step 5 — 获取用户信息

**如果 id_token 中已包含所需 claims（`email`、`name`、`picture`），无需再调用 userinfo 端点。**

仅在以下场景调用 userinfo：
- 需要获取比 id_token 更多的用户属性
- 需要获取实时最新的用户信息（如用户刚修改了个人资料）

```http
GET https://auth.example.com/userinfo
Authorization: Bearer {access_token}
```

**响应示例：**

```json
{
  "sub":            "usr_01HXEXAMPLE",
  "email":          "user@example.com",
  "email_verified": true,
  "name":           "张三",
  "picture":        "https://example.com/avatar.jpg"
}
```

**注意：**
- 返回的 claims 由 `access_token` 中的 scope 决定
- `sub` 是唯一稳定标识符，邮箱可能被用户更改，**应使用 `sub` 关联用户**

---

### 5.7 Step 6 — 使用 Access Token 调用 API

将 access_token 作为 Bearer Token 放在 HTTP Authorization 请求头中：

```http
GET https://api.example.com/some-resource
Authorization: Bearer {access_token}
```

**Resource Server 验证 access_token 的逻辑：**

```javascript
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = "https://auth.example.com";
const JWKS   = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

async function verifyAccessToken(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Bearer token");
  }
  const token = authorizationHeader.slice(7);

  const { payload } = await jwtVerify(token, JWKS, {
    issuer:     ISSUER,
    algorithms: ["ES256"],
    // 如需验证 aud：audience: "my-resource-server"
  });

  // 区分 access_token 和 id_token（避免 id_token 被误用为 API 凭证）
  if (payload.token_use !== "access") {
    throw new Error("Invalid token_use: expected 'access'");
  }

  return {
    userId: payload.sub,
    email:  payload.email,   // 需要 email scope
    scopes: String(payload.scope || "").split(" "),
  };
}
```

**Access Token Payload 结构示例：**

```json
{
  "iss":        "https://auth.example.com",
  "sub":        "usr_01HXEXAMPLE",
  "aud":        "my-app",
  "scope":      "openid profile email offline_access",
  "token_use":  "access",
  "client_id":  "my-app",
  "email":      "user@example.com",
  "iat":        1700000000,
  "exp":        1700003600
}
```

---

### 5.8 Step 7 — 刷新 Access Token

access_token 具有一定的有效期（通常 1-8 小时），**建议在过期前 5 分钟主动刷新**，避免用户请求因 token 过期而失败。

> ⚠️ **Refresh Token Rotation**：标准实现要求每次刷新都颁发新的 refresh_token，旧的**立即失效**。接入方必须**原子性地替换**存储的 refresh_token，禁止缓存或重复使用旧值。

**端点：**

```http
POST https://auth.example.com/token
Content-Type: application/x-www-form-urlencoded
```

**请求参数：**

| 参数 | 说明 | 必填 |
|------|------|------|
| `grant_type` | 固定值 `refresh_token` | ✅ |
| `refresh_token` | 当前有效的 refresh_token | ✅ |
| `client_id` | 客户端 ID | ✅ |
| `client_secret` | 机密客户端必须 | confidential ✅ |

**示例（Public 客户端）：**

```bash
curl -X POST https://auth.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=rt_xxxxxx.yyyyyy" \
  -d "client_id=my-spa-app"
```

**示例（Confidential 客户端）：**

```bash
curl -X POST https://auth.example.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'my-app:my-secret' | base64)" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=rt_xxxxxx.yyyyyy"
```

**成功响应（HTTP 200）：**

```json
{
  "access_token":  "eyJ...new-access-token...",
  "refresh_token": "rt_aaaaaa.bbbbbb",
  "token_type":    "Bearer",
  "expires_in":    3600,
  "scope": "openid profile email offline_access"
}
```

> ⚠️ **响应中的 `refresh_token` 是新值，必须立即替换存储中的旧值。**
> 若重复使用旧 refresh_token，服务端的 Replay Detection 机制会吊销该用户在此客户端的**全部 token**，用户将被强制重新登录。

**并发刷新去重保护（防止 Replay Detection 触发）：**

```javascript
let refreshPromise = null; // 模块级单例锁

async function getValidAccessToken() {
  const expiryStr = localStorage.getItem("token_expiry");
  const expiry    = expiryStr ? new Date(expiryStr) : null;
  const BUFFER_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

  if (expiry && expiry.getTime() - Date.now() > BUFFER_MS) {
    return localStorage.getItem("access_token"); // 尚未过期
  }

  // 多个并发调用只发一个刷新请求，共享同一 Promise
  if (refreshPromise) return refreshPromise;

  refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function doRefresh() {
  const rt = localStorage.getItem("refresh_token");
  if (!rt) {
    redirectToLogin();
    throw new Error("No refresh token");
  }

  const res = await fetch("https://auth.example.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: rt,
      client_id:     "my-app",
    }),
  });

  if (!res.ok) {
    // refresh_token 已失效，清空状态，引导重新登录
    clearLocalTokens();
    redirectToLogin();
    throw new Error("Refresh token invalid or expired");
  }

  const data = await res.json();

  // 原子替换（旧 refresh_token 已被服务端作废）
  localStorage.setItem("access_token",  data.access_token);
  localStorage.setItem("refresh_token", data.refresh_token); // ← 必须更新
  localStorage.setItem("token_expiry",
    new Date(Date.now() + data.expires_in * 1000).toISOString()
  );
  return data.access_token;
}
```

**刷新失败处理规则：**

| 错误 | 说明 | 处理方式 |
|------|------|---------|
| `invalid_grant` | refresh_token 过期或被吊销 | 清空本地 token，跳转登录页 |
| `invalid_client` | client_id/secret 错误 | 检查配置 |
| 网络超时 | 网络问题 | 指数退避重试（最多 3 次），失败则跳登录页 |

---

### 5.9 Step 8 — 退出登录

退出登录分两个层次，按需选择组合：

#### 8.1 吊销 Refresh Token — RFC 7009（清除服务端 Token）

**必做步骤**：通知 IdP 服务端使 refresh_token 立即失效，防止 token 泄漏后被滥用。

```http
POST https://auth.example.com/revoke
Content-Type: application/x-www-form-urlencoded
```

**请求参数：**

| 参数 | 说明 | 必填 |
|------|------|------|
| `token` | 要吊销的 refresh_token | ✅ |
| `client_id` | 客户端 ID | ✅ |
| `client_secret` | 机密客户端必须（可用 Basic Auth） | confidential ✅ |

**示例（Public 客户端）：**

```bash
curl -X POST https://auth.example.com/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=rt_xxxxxx.yyyyyy" \
  -d "client_id=my-spa-app"
```

**示例（Confidential 客户端）：**

```bash
curl -X POST https://auth.example.com/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic $(echo -n 'my-app:my-secret' | base64)" \
  -d "token=rt_xxxxxx.yyyyyy"
```

**响应：** 无论 token 是否存在，均返回 **HTTP 200 空响应**（RFC 7009 §2.2 规定）。

#### 8.2 RP-Initiated Logout（终止 IdP 侧 SSO 浏览器 Session）

**可选步骤**：若需要彻底的单点登出（让 IdP 侧 Session 也失效，其他依赖同一 IdP Session 的 RP 也会失效），将用户浏览器重定向到：

```
GET https://auth.example.com/logout
  ?post_logout_redirect_uri=https://app.example.com/logged-out
```

**参数说明：**

| 参数 | 说明 |
|------|------|
| `post_logout_redirect_uri` | 登出完成后的跳转地址。必须与注册的 `redirect_uri` **精确匹配** |

**行为：**
- 清除 IdP 侧的 SSO Session（浏览器 Cookie + 服务端缓存）
- 若 `post_logout_redirect_uri` 合法则跳转，否则展示"已登出"提示页

#### 8.3 完整退出登录代码示例

```javascript
async function logout() {
  const refreshToken = getStoredRefreshToken(); // 从安全存储读取

  // Step 1: 吊销服务端 refresh_token（最重要，即使失败也继续）
  if (refreshToken) {
    try {
      await fetch("https://auth.example.com/revoke", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token:     refreshToken,
          client_id: "my-app",
        }),
      });
    } catch {
      // 忽略网络错误，继续清理本地状态
    }
  }

  // Step 2: 清除本地所有 token 和用户状态
  clearLocalTokens();
  clearUserState();

  // Step 3（可选）: 重定向到 IdP logout 端点，清除 SSO 浏览器 Session
  const returnUrl = encodeURIComponent("https://app.example.com/");
  window.location.href =
    `https://auth.example.com/logout?post_logout_redirect_uri=${returnUrl}`;
}
```

---

## 六、Token 规范

### 6.1 access_token（JWT）

**Header：**
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "kid": "key-1"
}
```

**Payload：**
```json
{
  "iss":       "https://auth.example.com",
  "sub":       "usr_01HXEXAMPLE",
  "aud":       "my-app",
  "scope":     "openid profile email offline_access",
  "token_use": "access",
  "client_id": "my-app",
  "email":     "user@example.com",
  "iat":       1700000000,
  "exp":       1700003600
}
```

### 6.2 id_token（JWT）

**Header：**
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "kid": "key-1"
}
```

**Payload：**
```json
{
  "iss":            "https://auth.example.com",
  "sub":            "usr_01HXEXAMPLE",
  "aud":            "my-app",
  "token_use":      "id",
  "nonce":          "Rq7TzH4sNd6mYk1o",
  "email":          "user@example.com",
  "email_verified": true,
  "name":           "张三",
  "picture":        "https://example.com/avatar.jpg",
  "iat":            1700000000,
  "exp":            1700003600
}
```

### 6.3 refresh_token

- **格式**：不透明字符串（非 JWT），通常形如 `{id}.{secret}`
- **有效期**：各 IdP 不同，通常 30 天 ~ 90 天
- **存储**：服务端存储 hash，不存明文；客户端存于 Keychain（iOS/macOS）、EncryptedSharedPreferences（Android）、httpOnly Cookie（Web）
- **轮换**：每次使用后颁发新值，旧值立即失效（Refresh Token Rotation）

---

## 七、Scopes 与 Claims

| Scope | 包含的 Claims | 说明 |
|-------|--------------|------|
| `openid` | `sub`, `iss`, `aud`, `exp`, `iat` | **必须包含**，标识本次流程为 OIDC 流程 |
| `profile` | `name`, `picture` | 用户展示名称与头像 |
| `email` | `email`, `email_verified` | 用户邮箱及验证状态 |
| `offline_access` | —（触发 refresh_token 颁发） | 需要离线/长期访问能力时申请 |

**Claims 说明：**

| Claim | 类型 | 说明 |
|-------|------|------|
| `sub` | string | 用户唯一 ID，**永久不变**。应以此为用户主键，而非邮箱 |
| `iss` | string | Token 签发方 URL（必须完整匹配） |
| `aud` | string | Token 预期接收方（client_id） |
| `exp` | number | Unix 时间戳，Token 过期时间 |
| `iat` | number | Unix 时间戳，Token 颁发时间 |
| `email` | string | 用户邮箱（通常已规范化为小写） |
| `email_verified` | boolean | 邮箱是否已验证 |
| `name` | string / null | 用户展示名称 |
| `picture` | string / null | 头像 URL |
| `nonce` | string | 防重放随机值（仅在 id_token 中，当请求携带 nonce 时） |

> **重要：** 始终使用 `sub` 作为用户数据库的外键，不要使用 `email`。用户可能更改邮箱，但 `sub` 永久不变。

---

## 八、各平台完整代码示例

### 8.1 Web SPA（TypeScript）

```typescript
// oidc-client.ts — 标准 OIDC 客户端（无第三方库依赖）

const ISSUER     = "https://auth.example.com";
const CLIENT_ID  = "my-spa";
const REDIRECT_URI = `${window.location.origin}/auth/callback`;
const SCOPE = "openid profile email offline_access";

// ── PKCE 工具函数 ─────────────────────────────────────────────────────

async function generatePKCE() {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const digest = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(verifier)
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { verifier, challenge };
}

function randomBase64url(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── 发起登录 ───────────────────────────────────────────────────────────

export async function login() {
  const { verifier, challenge } = await generatePKCE();
  const state = randomBase64url();
  const nonce = randomBase64url();

  sessionStorage.setItem("oidc_pkce_verifier", verifier);
  sessionStorage.setItem("oidc_state",         state);
  sessionStorage.setItem("oidc_nonce",         nonce);
  sessionStorage.setItem("oidc_return_to",     location.pathname + location.search);

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    response_type:         "code",
    scope:                 SCOPE,
    state,
    nonce,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  location.href = `${ISSUER}/authorize?${params}`;
}

// ── 处理回调 ───────────────────────────────────────────────────────────

export async function handleCallback(): Promise<{
  userId: string; email?: string; name?: string;
}> {
  const params = new URLSearchParams(location.search);
  const code  = params.get("code");
  const state = params.get("state");
  const iss   = params.get("iss");
  const error = params.get("error");

  if (error) throw new Error(`Auth error: ${error} — ${params.get("error_description")}`);

  if (state !== sessionStorage.getItem("oidc_state"))
    throw new Error("State mismatch");
  if (iss && iss !== ISSUER)
    throw new Error("Issuer mismatch");
  if (!code)
    throw new Error("Missing authorization code");

  const verifier = sessionStorage.getItem("oidc_pkce_verifier")!;
  sessionStorage.removeItem("oidc_pkce_verifier");
  sessionStorage.removeItem("oidc_state");

  // 兑换 Token
  const res = await fetch(`${ISSUER}/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code:          code!,
      redirect_uri:  REDIRECT_URI,
      client_id:     CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  const tokens = await res.json() as {
    access_token: string; id_token: string;
    refresh_token?: string; expires_in: number;
  };

  // 保存 tokens
  sessionStorage.setItem("access_token", tokens.access_token);
  if (tokens.refresh_token)
    localStorage.setItem("refresh_token", tokens.refresh_token);
  localStorage.setItem("token_expiry",
    new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  );

  // 解析并验证 id_token（生产环境建议用 jose 库做完整签名验证）
  const idPayload = JSON.parse(
    atob(tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
  );
  const savedNonce = sessionStorage.getItem("oidc_nonce");
  sessionStorage.removeItem("oidc_nonce");
  if (idPayload.nonce !== savedNonce) throw new Error("Nonce mismatch");
  if (idPayload.aud  !== CLIENT_ID)   throw new Error("Audience mismatch");
  if (idPayload.iss  !== ISSUER)      throw new Error("Issuer mismatch in id_token");
  if (idPayload.exp  < Date.now() / 1000) throw new Error("id_token expired");

  return { userId: idPayload.sub, email: idPayload.email, name: idPayload.name };
}

// ── 退出登录 ───────────────────────────────────────────────────────────

export async function logout() {
  const rt = localStorage.getItem("refresh_token");
  if (rt) {
    await fetch(`${ISSUER}/revoke`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: rt, client_id: CLIENT_ID }),
    }).catch(() => {});
  }
  sessionStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("token_expiry");
  location.href = `${ISSUER}/logout?post_logout_redirect_uri=${encodeURIComponent(location.origin + "/")}`;
}
```

### 8.2 服务端（Node.js / TypeScript）

```typescript
// server-oidc.ts — 服务端 OIDC 接入（Express / Hono / Fastify 通用）
import { createRemoteJWKSet, jwtVerify } from "jose";
import crypto from "crypto";

const ISSUER        = "https://auth.example.com";
const CLIENT_ID     = "my-server-app";
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET!;
const REDIRECT_URI  = "https://app.example.com/auth/callback";

const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

// ── 生成授权 URL ───────────────────────────────────────────────────────

export function buildAuthorizationUrl(session: Record<string, string>): string {
  const state    = crypto.randomBytes(16).toString("base64url");
  const nonce    = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  Object.assign(session, {
    oidc_state:    state,
    oidc_nonce:    nonce,
    pkce_verifier: verifier,
  });

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    response_type:         "code",
    scope:                 "openid profile email offline_access",
    state, nonce,
    code_challenge:        challenge,
    code_challenge_method: "S256",
  });
  return `${ISSUER}/authorize?${params}`;
}

// ── 处理授权回调 ───────────────────────────────────────────────────────

export async function handleCallback(
  query:   Record<string, string>,
  session: Record<string, string>
) {
  const { code, state, iss, error } = query;
  if (error) throw new Error(`Auth error: ${error}`);
  if (state !== session.oidc_state) throw new Error("State mismatch");
  if (iss && iss !== ISSUER)        throw new Error("Issuer mismatch");
  if (!code) throw new Error("Missing authorization code");

  // 兑换 Token（使用 HTTP Basic Auth）
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${ISSUER}/token`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  REDIRECT_URI,
      code_verifier: session.pkce_verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  const tokens = await res.json();

  // 完整验证 id_token
  const { payload } = await jwtVerify(tokens.id_token, JWKS, {
    issuer:     ISSUER,
    audience:   CLIENT_ID,
    algorithms: ["ES256"],
  });
  if (payload.nonce !== session.oidc_nonce) throw new Error("Nonce mismatch");

  // 清理 session 中的临时 OIDC 状态
  delete session.oidc_state;
  delete session.oidc_nonce;
  delete session.pkce_verifier;

  return { tokens, user: payload };
}

// ── 刷新 Token ────────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${ISSUER}/token`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
  return res.json(); // 必须保存返回的新 refresh_token
}

// ── 吊销 Token ────────────────────────────────────────────────────────

export async function revokeToken(refreshToken: string): Promise<void> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  await fetch(`${ISSUER}/revoke`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${basic}`,
    },
    body: new URLSearchParams({ token: refreshToken }),
  });
  // RFC 7009: 服务端始终返回 200，无需检查响应体
}
```

### 8.3 Native App（Swift / iOS / macOS）

```swift
// OIDCClient.swift — 标准 OIDC Native App 接入
import Foundation
import AuthenticationServices
import CryptoKit
import Security

class OIDCClient: NSObject, ASWebAuthenticationPresentationContextProviding {

    let issuer      = "https://auth.example.com"
    let clientId    = "my-native-app"
    let redirectUri = "myapp://auth/callback"   // 自定义 URL Scheme
    let scope       = "openid profile email offline_access"

    private var pkceVerifier = ""
    private var savedState   = ""
    private var savedNonce   = ""

    // ── PKCE 工具 ─────────────────────────────────────────────────────

    private func randomBase64url(_ byteCount: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        _ = SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes)
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func sha256Base64url(_ input: String) -> String {
        let hash = SHA256.hash(data: Data(input.utf8))
        return Data(hash).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // ── 发起登录 ──────────────────────────────────────────────────────

    func login() async throws -> (accessToken: String, refreshToken: String?) {
        pkceVerifier = randomBase64url(64)
        savedState   = randomBase64url()
        savedNonce   = randomBase64url()
        let challenge = sha256Base64url(pkceVerifier)

        var comps = URLComponents(string: "\(issuer)/authorize")!
        comps.queryItems = [
            .init(name: "client_id",             value: clientId),
            .init(name: "redirect_uri",          value: redirectUri),
            .init(name: "response_type",         value: "code"),
            .init(name: "scope",                 value: scope),
            .init(name: "state",                 value: savedState),
            .init(name: "nonce",                 value: savedNonce),
            .init(name: "code_challenge",        value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
        ]

        let callbackURL = try await withCheckedThrowingContinuation {
            (cont: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(
                url: comps.url!,
                callbackURLScheme: "myapp"
            ) { url, error in
                if let e = error { cont.resume(throwing: e) }
                else if let u = url { cont.resume(returning: u) }
            }
            session.prefersEphemeralWebBrowserSession = false
            session.presentationContextProvider = self
            session.start()
        }

        // 解析回调
        let cbComps = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)!
        let items   = Dictionary(
            uniqueKeysWithValues: (cbComps.queryItems ?? []).map { ($0.name, $0.value ?? "") }
        )
        guard items["error"] == nil         else { throw OIDCError.authError(items["error"]!) }
        guard items["state"] == savedState  else { throw OIDCError.stateMismatch }
        guard let code = items["code"]      else { throw OIDCError.missingCode }

        return try await exchangeCode(code)
    }

    // ── 兑换 Token ────────────────────────────────────────────────────

    private func exchangeCode(_ code: String) async throws -> (String, String?) {
        var req = URLRequest(url: URL(string: "\(issuer)/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = urlEncode([
            "grant_type":    "authorization_code",
            "code":          code,
            "redirect_uri":  redirectUri,
            "client_id":     clientId,
            "code_verifier": pkceVerifier,
        ])
        let (data, _) = try await URLSession.shared.data(for: req)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let at = json["access_token"] as? String else {
            throw OIDCError.tokenError("No access_token in response")
        }
        // 验证 id_token nonce（简化版，生产需完整 JWT 签名验证）
        if let idToken = json["id_token"] as? String {
            let payload = decodeJWTPayload(idToken)
            if (payload["nonce"] as? String) != savedNonce {
                throw OIDCError.nonceMismatch
            }
        }
        return (at, json["refresh_token"] as? String)
    }

    // ── 刷新 Token ────────────────────────────────────────────────────

    func refresh(refreshToken: String) async throws -> (accessToken: String, newRefreshToken: String?) {
        var req = URLRequest(url: URL(string: "\(issuer)/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = urlEncode([
            "grant_type":    "refresh_token",
            "refresh_token": refreshToken,
            "client_id":     clientId,
        ])
        let (data, res) = try await URLSession.shared.data(for: req)
        guard (res as? HTTPURLResponse)?.statusCode == 200 else {
            throw OIDCError.tokenError("Refresh failed")
        }
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let at = json["access_token"] as? String else {
            throw OIDCError.tokenError("No access_token")
        }
        return (at, json["refresh_token"] as? String)
    }

    // ── 吊销 Token ────────────────────────────────────────────────────

    func revoke(refreshToken: String) async {
        var req = URLRequest(url: URL(string: "\(issuer)/revoke")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.httpBody = urlEncode(["token": refreshToken, "client_id": clientId])
        _ = try? await URLSession.shared.data(for: req)
    }

    // ── 工具 ──────────────────────────────────────────────────────────

    private func urlEncode(_ params: [String: String]) -> Data? {
        var cs = CharacterSet.alphanumerics; cs.insert(charactersIn: "-._~")
        return params.map { k, v in
            "\(k.addingPercentEncoding(withAllowedCharacters: cs) ?? k)=\(v.addingPercentEncoding(withAllowedCharacters: cs) ?? v)"
        }.joined(separator: "&").data(using: .utf8)
    }

    private func decodeJWTPayload(_ jwt: String) -> [String: Any] {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return [:] }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSWindow()
    }
}

enum OIDCError: LocalizedError {
    case authError(String), stateMismatch, missingCode, nonceMismatch, tokenError(String)
    var errorDescription: String? {
        switch self {
        case .authError(let e): return "Auth error: \(e)"
        case .stateMismatch:    return "State mismatch"
        case .missingCode:      return "Missing authorization code"
        case .nonceMismatch:    return "Nonce mismatch"
        case .tokenError(let e):return "Token error: \(e)"
        }
    }
}
```

---

## 九、错误处理

### Token 端点错误码

| HTTP 状态 | error | 说明 | 处理方式 |
|-----------|-------|------|---------|
| 400 | `invalid_request` | 缺少必填参数或参数格式错误 | 检查请求构造逻辑 |
| 400 | `invalid_grant` | code 无效/过期/已用；或 refresh_token 无效/过期/被吊销 | 清空 token，引导重新登录 |
| 400 | `unsupported_grant_type` | grant_type 值不受支持 | 检查 grant_type 值 |
| 401 | `invalid_client` | client_id 不存在或 secret 错误 | 检查客户端配置 |
| 429 | — | 请求频率超限 | 指数退避重试 |

### 授权端点错误（通过 redirect_uri 回调）

| error | 说明 | 处理方式 |
|-------|------|---------|
| `access_denied` | 用户拒绝授权 | 告知用户，提供重试入口 |
| `invalid_scope` | 申请的 scope 不被允许 | 检查注册的 allowed_scopes |
| `unsupported_response_type` | response_type 不支持 | 固定使用 `code` |
| `server_error` | 服务端内部错误 | 稍后重试 |

### 通用 API 请求错误处理流程

```javascript
async function apiCall(url, options = {}) {
  const token = await getValidAccessToken(); // 内部自动 refresh
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token 可能在极短时间内被吊销，强制刷新一次
    try {
      const newToken = await forceRefresh();
      return fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${newToken}` },
      });
    } catch {
      logout(); // 刷新失败，会话彻底失效
      throw new Error("Session expired");
    }
  }

  return res;
}
```

---

## 十、安全检查清单

接入方上线前必须逐项确认：

### 必须完成（阻断性安全要求）

- [ ] **PKCE**：所有 public 客户端必须使用 `code_challenge_method=S256`，禁止 plain
- [ ] **State 验证**：回调中严格验证 `state` 与发起时的值完全一致，不匹配则拒绝
- [ ] **Nonce 验证**：严格验证 id_token 中的 `nonce` 与存储值一致，完成后删除
- [ ] **iss 验证**：验证 id_token 的 `iss` 完整 URL 匹配（`https://auth.example.com`），不仅看域名
- [ ] **aud 验证**：验证 id_token 的 `aud` === 自己的 `client_id`，防接受他人 Token
- [ ] **exp 验证**：验证 id_token 未过期
- [ ] **alg 验证**：只接受 `ES256`，明确拒绝 `none` 和 `HS256`
- [ ] **回调验证 iss 参数**：验证 redirect_uri 回调中的 `iss` 参数（RFC 9207）
- [ ] **client_secret 不暴露在前端**：confidential 客户端的换 token 请求必须在服务端发起
- [ ] **refresh_token 轮换**：每次刷新后立即替换存储的 refresh_token，禁止缓存旧值
- [ ] **redirect_uri 精确注册**：注册精确 URL，不使用正则、通配符或 origin-only 方式

### 强烈推荐

- [ ] **JWKS 缓存**：本地缓存公钥（建议 1 小时），避免每次请求 `/jwks.json`
- [ ] **并发刷新去重**：使用 Promise/Task 锁，防止多个并发请求同时使用同一 refresh_token
- [ ] **access_token 不存 localStorage**（SPA）：存内存或 sessionStorage，防 XSS 盗取后长期滥用
- [ ] **refresh_token 安全存储**：Web → httpOnly Cookie；Native → Keychain/KeyStore；Server → 加密数据库
- [ ] **HTTPS Only**：所有 redirect_uri 必须是 HTTPS（本地开发环境 localhost 除外）
- [ ] **logout 调用 revoke**：退出前调用 `/revoke`，确保服务端立即失效，防 token 泄漏后滥用

### Token 存储安全建议

| 平台 | access_token | refresh_token |
|------|-------------|---------------|
| Web SPA | 内存变量（推荐）/ sessionStorage | httpOnly SameSite Cookie 或 BFF 代理 |
| Web（有后端） | 服务端 session（不下发给前端） | 加密数据库或服务端 session |
| iOS / macOS | 内存 | Keychain（`kSecAttrAccessibleWhenUnlocked`） |
| Android | 内存 | `EncryptedSharedPreferences` / Android Keystore |
| Desktop（Electron 等）| 内存 | OS 原生密钥存储（Keychain / Credential Manager） |
