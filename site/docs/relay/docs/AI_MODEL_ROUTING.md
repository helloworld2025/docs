# AI 模型调用规则

> 更新于 2026-07-04，基于 `server/src/routes/ai.rs`、`server/src/config.rs`、`mac/Sources/Settings.swift`、`mac/Sources/VoiceInputApp.swift`。

---

## 一、总体架构

```
Mac 客户端
  │
  ├── useRelayServer = true（默认）
  │       └── RelayAPIClient → Relay Server → 各 AI Provider
  │
  └── useRelayServer = false（开发调试）
          └── 直连 AI Provider API（使用 Secrets.swift 中的 key）
```

**Relay Server** 是唯一持有 API Key 的一方，Key 不随客户端分发。  
所有生产流量必须经过 Relay Server，直连模式仅供本地开发使用。

---

## 二、客户端 Provider 选择（ApiProvider）

`AppSettings.shared.apiProvider` 决定请求走哪条 Server 路由：

| ApiProvider 枚举值 | Server 端点 | 说明 |
|---|---|---|
| `.openRouter` | `POST /api/ai/openrouter` | 默认，支持 OpenRouter 全部模型；Gemini 模型会在服务端自动转发到 Vertex（见下节） |
| `.aliyunQwen` | `POST /api/ai/qwen` | 阿里云百炼 DashScope，SSE 流式输出，专供千问多模态模型 |
| `.vertexAI` | `POST /api/ai/vertex` | GCP Vertex AI 原生 Gemini API，Service Account 认证 |

### Beta 版的强制选择

`applyBetaDefaultsIfNeeded()` 在 Beta 首次启动时写死：

- **海外模式**：`apiProvider = .vertexAI`，`vertexModelName = "google/gemini-3.5-flash"`
- **中国模式**：`apiProvider = .aliyunQwen`，`qwenModelName = "qwen3.5-omni-plus"`

用户在设置里切换 `betaModelChoice` 即可在两者之间切换。

---

## 三、服务端路由详情

### 3.1 `/api/ai/openrouter` — 智能路由（含 Gemini 自动转发 & TW 区域特殊处理）

```
收到请求
  │
  ├── 解析 body.model
  │
  ├── model 以 "google/" 或 "gemini-" 开头？
  │       └── 是 → RELAY_REGION == "tw"？
  │                   ├── 是 → proxy_gemini_as_qwen()
  │                   │         将请求转换为阿里云 Qwen 格式后转发（见 §3.1.1）
  │                   └── 否 → proxy_vertex()
  │                             走 Vertex 原生 API，不经 OpenRouter
  │
  └── 否 → 转发到 OpenRouter
              URL: https://openrouter.ai/api/v1/chat/completions
              Headers: HTTP-Referer: https://relay.tech, X-Title: Relay
              Auth: Bearer {OPENROUTER_API_KEY}
```

**设计意图**：客户端统一以 `openRouter` 为入口，服务端自动识别 Gemini 模型并绕过 OpenRouter 路由到 Vertex，节省中间路由费用，同时支持音频等原生能力。TW 区域例外走 Qwen（详见下节）。

#### 3.1.1 TW 区域：Gemini → 阿里云 Qwen 自动转换

**触发条件**：服务端环境变量 `RELAY_REGION=tw`（由 deploy.js 在台湾 Cloud Run 部署时自动注入）。

**原因**：Vertex AI 在台湾（asia-east1）延迟较高，而阿里云 DashScope 在亚太的 omni 系列支持等效的多模态（音频 + 图片）能力，且台湾访问速度更快。

**服务端 body 转换规则**（客户端请求无需任何改动）：

| 字段 | 原值 | 转换后 |
|---|---|---|
| `model` | `google/gemini-3.5-flash` | `qwen3.5-omni-plus` |
| `input_audio.data` | `<plain_base64>` | `data:;base64,<base64>`（Aliyun 格式） |
| `modalities` | 无 | `["text"]`（Aliyun 必须字段） |
| `stream` | 无 | `false`（非流式，与客户端 `send()` 对应） |
| `reasoning` | `{"effort":"low"}` | 移除（Aliyun 不支持） |
| `stream_options` | 无/有 | 移除 |
| 其余字段 | 原样 | 原样保留 |

转换后转发到阿里云 DashScope（`ALIYUN_API_KEY` 在所有 Cloud Run 区域均已配置），返回标准 OpenAI 兼容 JSON，客户端完全透明。

### 3.2 `/api/ai/qwen` — 阿里云百炼

```
URL: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
Auth: Bearer {ALIYUN_API_KEY}
格式: OpenAI 兼容格式（SSE 流式输出）
```

### 3.3 `/api/ai/vertex` — GCP Vertex AI 原生 Gemini

```
输入: OpenAI Chat Completions 格式
  │
  ├── 读取/刷新 Service Account OAuth2 Token（内存缓存，过期自动刷新）
  │
  ├── 提取 model（去掉 "google/" 前缀）
  │
  ├── 格式转换: OpenAI → 原生 Gemini API 格式
  │       ├── system message → systemInstruction
  │       ├── user/assistant → contents[role=user/model]
  │       ├── text → parts[{text}]
  │       ├── input_audio → parts[{inlineData: {mimeType, data}}]
  │       │     支持: mp4/m4a → audio/mp4, wav → audio/wav,
  │       │           ogg → audio/ogg, flac → audio/flac, webm → audio/webm
  │       └── image_url (data URI) → parts[{inlineData: {mimeType, data}}]
  │
  ├── 推理强度映射（reasoning.effort → thinkingConfig.thinkingBudget）
  │       high   → 16384 tokens
  │       medium →  8192 tokens
  │       low    →  2048 tokens
  │       none/未设 →     0（关闭 thinking）
  │
  ├── 安全设置：全部 OFF（HATE_SPEECH / DANGEROUS_CONTENT / SEXUALLY_EXPLICIT / HARASSMENT）
  │
  ├── 调用 Vertex AI 原生端点
  │     https://{location}-aiplatform.googleapis.com/v1/projects/{project}/
  │     locations/{location}/publishers/google/models/{model}:generateContent
  │     （location=global 时不加区域前缀）
  │
  └── 格式转换: Gemini 响应 → OpenAI Chat Completions 格式
        ├── 过滤 thought=true 的 thinking parts
        ├── finishReason → finish_reason
        │     STOP → stop, MAX_TOKENS → length, SAFETY/RECITATION → content_filter
        └── usageMetadata → usage.prompt_tokens / completion_tokens
```

### 3.4 `/api/ai/stepfun` — 阶跃星辰

```
URL: https://api.stepfun.com/v1/chat/completions
Auth: Bearer {STEPFUN_API_KEY}
用途: 保留路由，当前 Mac 客户端不直接使用
```

### 3.5 `/api/ai/ocr` — SiliconFlow（DeepSeek-OCR）

```
URL: https://api.siliconflow.cn/v1/chat/completions
Auth: Bearer {SILICONFLOW_API_KEY}
用途: 历史记录页「获取原始语音转文字」功能（OpenRouterASRService）
```

### 3.6 `/api/ai/perplexity` — 联网搜索

```
URL: https://api.perplexity.ai/chat/completions
Auth: Bearer {PERPLEXITY_API_KEY}
用途: 开启「联网搜索」后的 Web Search 查询（WebSearchService）
```

---

## 四、默认模型配置

| 用途 | 模型 | 走哪条路 |
|---|---|---|
| 主流程（生产 Relay 模式） | `google/gemini-3.5-flash` | openRouter → Vertex 自动转发 |
| Beta 海外默认 | `google/gemini-3.5-flash` | vertexAI |
| Beta 中国默认 | `qwen3.5-omni-plus` | aliyunQwen |
| Dynamic Agent 代码生成 | `anthropic/claude-sonnet-4.6` | openRouter → OpenRouter |
| 记忆处理 / 场景后台整理 | `deepseek/deepseek-v4-pro` | openRouter → OpenRouter |

---

## 五、Gemini 思考强度（ThinkingEffort）

在设置中选择的 `geminiThinkingEffort` 由 Mac 客户端转换为 `reasoning.effort` 字段随请求发送，Relay Server 再映射为 Vertex `thinkingBudget`：

| 设置值 | `reasoning.effort` | `thinkingBudget` |
|---|---|---|
| Minimal | `"minimal"` | 0（关闭） |
| Low（默认） | `"low"` | 2048 |
| Medium | `"medium"` | 8192 |
| High | `"high"` | 16384 |

---

## 六、请求认证

所有 Server 端点均要求 Relay 账户 JWT（除 OCR/Perplexity 等辅助路由外，`_user: AuthUser` 用 `_` 表示已通过中间件验证但路由内不再单独检查）。  
`AuthUser` 由 `server/src/auth/middleware.rs` 提取并验证 `account.relay.tech` 颁发的 JWT。

---

## 七、直连模式（useRelayServer = false）

关闭 Relay Server 时，Mac 客户端读取 `mac/Sources/Secrets.swift`（不进版本控制）中的 key 直连各 Provider：

- `.openRouter` → `https://openrouter.ai/api/v1/chat/completions`（使用 `openRouterAPIKey`）
- `.aliyunQwen` → `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`（使用 `aliyunAPIKey`）
- `.vertexAI` → 同 Server 端逻辑，需本地配置 GCP Service Account（使用 `vertexServiceAccountJSON`）

**仅供本地开发调试，生产环境务必开启 Relay Server 模式。**

---

## 八、服务端环境变量速查

| 变量名 | 说明 | 默认值 |
|---|---|---|
| `RELAY_REGION` | 部署区域（deploy.js 自动注入）：`tw` / `us` / `eu`；TW 区域 Gemini 自动改走 Qwen | 空（本地/test） |
| `OPENROUTER_API_KEY` | OpenRouter API Key | （必须配置） |
| `OPENROUTER_BASE_URL` | OpenRouter 基础 URL | `https://openrouter.ai/api/v1` |
| `ALIYUN_API_KEY` | 阿里云百炼 API Key | （必须配置） |
| `ALIYUN_BASE_URL` | 阿里云百炼基础 URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `VERTEX_PROJECT_ID` | GCP 项目 ID | （必须配置） |
| `VERTEX_LOCATION` | GCP 区域 | `us-central1` |
| `VERTEX_SERVICE_ACCOUNT_JSON` | GCP 服务账号 JSON 完整内容 | （必须配置） |
| `STEPFUN_API_KEY` | 阶跃星辰 API Key | （可选） |
| `SILICONFLOW_API_KEY` | SiliconFlow API Key（OCR） | （可选） |
| `PERPLEXITY_API_KEY` | Perplexity API Key（Web Search） | （可选） |
