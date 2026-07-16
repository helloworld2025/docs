# Testlab：全自动化 Agent 式测试体系（设计稿）

> 目标：建一个独立的测试项目 `testlab/`（与 `mac/` 平级），实现
> 「测试目的 → 自动生成测试计划 → TTS 合成真实音频 → 跑真实管线 → LLM judge 收敛分析 → 优化建议」
> 的完整闭环。让大规模、多样化 case 的回归测试脱离人力。
>
> 已拍板：放在同仓库顶层 `testlab/`；编排层用 Python；Swift 侧只加一个薄的 CLI 入口。
> **所有模型（plan/TTS/judge/analyze/主管线）统一走 OpenRouter**，各阶段模型在
> `testlab/config.yaml` 的 `models:` 里独立配置。TTS 用云端方案（OpenRouter
> `/api/v1/audio/speech`，OpenAI 兼容），保证音质与多语言可用性，不用本地 edge-tts。
> 计划中含 `prerequisites` 机制：执行前需要用户准备的外部条件（账号、key、真实语料等）
> 由 plan 列出，用户补全确认后才能跑。
>
> **实现状态（2026-06-10）**：Phase 0 + Phase 1 骨架已落地并跑通端到端冒烟
> （TTS 音频 → VAD → 真实云调用 → 路由分类 → usage/成本捕获，单 case 实测 $0.0087）。

---

## 0. 可行性基础（基于现有代码的关键事实）

| # | 事实 | 出处 | 对设计的影响 |
|---|---|---|---|
| 1 | 主管线从 `processAudioFile(url:)` 起全程以**文件 URL** 为接口（录音只是写临时 WAV） | `VoiceInputApp.swift:1056`、`AIAudioProvider.swift:63` | 后台车道不需要虚拟麦克风，TTS 生成 WAV 直接喂入，走 100% 真实管线 |
| 2 | phase1 是「音频 + system prompt 一次云调用」，ASR 与 LLM **不分离** | `AIAudioProvider.swift:118-130` | 没有纯文本入口，TTS 是必经之路（也因此保真度天然高） |
| 3 | 已有独立的字面转写服务 `OpenRouterASRService.transcribe(fileURL:)` | `OpenRouterAI.swift:57-128` | judge 时对同一音频跑对照转写，可精确区分「ASR 听错」vs「LLM 改写错」 |
| 4 | Context 全部参数化传入（appBundleID / selectedContext / 记忆 / 场景规则） | `PromptManager.getPrompt(...)`、`processAudioFile(url:appBundleID:selectedContext:...)` | mock context 成本极低，无需 GUI |
| 5 | 截图是可选增强，非硬依赖（D2 决策） | `docs/AGENT_SKILL_REFACTOR.md` §D2 | 无头跑不受屏幕录制权限限制 |
| 6 | `InputHistory` 存有真实用户历史音频，且支持重跑 | `VoiceInputApp.swift:246-477` (`handleRetryFailed`) | 可建「真人录音回归集」，弥补 TTS 音频过于干净的偏差 |
| 7 | `TextInjector` **没有** dry-run 模式（必定产生剪贴板/键盘副作用） | `TextInjector.swift:138` | 主仓库需加一个「只返回文本」模式（唯一硬缺口） |
| 8 | token usage **没有任何记录** | `RelayAPIClient.swift` | 成本预估/核算依赖补这个口子 |
| 9 | SPM 单 executable target，无测试 target、无 CLI 模式（仅 `--vad-selftest`） | `Package.swift`、`VoiceInputApp.swift:62` | 需拆 library target + 新增 TestRunner CLI |

---

## 1. 总体架构

```
测试目的（一句话，如「测中英混合术语听写质量」）
   │
   ▼
① Plan Generator（agent）
   │   产出测试计划：方案说明 + case 列表 + 预估 token 成本
   ▼
② Audio Synthesizer
   │   TTS 渲染 utterance → WAV（缓存复用）；可选加噪/变速/多音色
   ▼
③ Execution Engine（双车道）
   │   Lane B 后台：RelayTestRunner CLI → 真实云调用 → dry-run 不注入（可并行、不占机器）
   │   Lane A 前台：test hook 驱动真实 app → 真实注入/Agent 执行 → AX 读回验证（独占机器）
   ▼
④ Result Collector
   │   每 case 记录：VAD 时长 / 对照转写 / LLM 原始响应 / 解析出的 intent /
   │   最终文本 / 各阶段延迟 / token 用量与实际成本
   ▼
⑤ Convergence Analyzer（judge agent）
       good/bad 分类 → 失败模式聚类 → 定位环节 → 优化建议（含 prompt diff）→ 报告
```

### 1.1 case 数据模型

```jsonc
{
  "id": "dictation-mixed-001",
  "goal": "中英混合术语听写",
  "utterance": "帮我把这个 PR 的 description 改成中文再发出去",
  "tts": { "voice": "zh-CN-XiaoxiaoNeural", "rate": "+8%", "noise": null },
  "context": {
    "appBundleID": "com.microsoft.VSCode",
    "selectedText": "...",          // 模拟圈选内容，可空
    "memoryContext": "...",          // 模拟长期记忆注入，可空
    "scene": "coding"
  },
  "expected": {
    "type": "dictation",             // dictation | qa | agent_intent | no_speech
    "rubric": "应保留英文术语 PR/description 原文；不得执行 agent 动作"
  }
}
```

### 1.2 runner 结果模型（RelayTestRunner 输出）

```jsonc
{
  "caseId": "dictation-mixed-001",
  "stages": {
    "vad":       { "voicedMs": 3210, "passed": true },
    "asrOracle": { "transcript": "..." },          // OpenRouterASRService 字面转写（judge 对照用）
    "llm":       { "rawResponse": "...", "model": "...", "latencyMs": 1840,
                   "usage": { "promptTokens": 0, "completionTokens": 0, "audioTokens": 0 } },
    "routing":   { "parsedIntent": null, "markers": [] },  // [SKILL:]/[DYNAMIC_AGENT]/[ACT] 等
    "output":    { "finalText": "...", "injectionMode": "dryRun" }
  },
  "cost": { "usd": 0.0021 },
  "error": null
}
```

---

## 2. 双车道设计

### Lane B：后台无头车道（主力，覆盖 80% 测试面）

覆盖：听写质量、prompt 规则遵守、记忆/场景/个人词典注入效果、Q&A 模式、
NO_SPEECH 闸门行为、**Agent intent 解析正确性**（解析到 intent/marker 为止，不真执行）。

运行方式：`testlab` 的 Python runner 并发调用 `RelayTestRunner` CLI 子进程，
每个 case 一进一出 JSON。完全后台，不影响正常使用电脑。

### Lane A：前台 runtime 车道（独占机器）

覆盖：真实文本注入（clipboard/CGEvent + 焦点检测）、Agent/Skill 真实执行
（操作真实 app）、ExecutionGate/确认交互。

分两层，按保真度递进：

| 层 | 驱动方式 | 验证方式 | 用途 |
|---|---|---|---|
| A1 | app 内置 test hook（unix socket 或 URL scheme）：「以此 WAV + context 触发完整处理，含真实注入与 agent 执行」 | AX 读回目标 app 内容 / 检查系统副作用（日历事件、备忘录等） | 注入与 agent 执行的回归主力 |
| A2 | BlackHole 虚拟声卡播放音频 + 模拟热键，全链路含「麦克风」 | 同上 | 少量 case 的最终全真冒烟 |

前台车道运行时 orchestrator 弹出明显提示并锁定流程，跑完自动汇总。

---

## 3. 主仓库最小改动清单（全部 additive）

1. **`Package.swift` 拆分**：`VoiceInputCore`（library，现 Sources 主体）
   + `VoiceInputMac`（app 壳）+ `RelayTestRunner`（CLI executable）。
   AppKit 强依赖部分（Overlay、热键、菜单栏）留在 app 壳层。
2. **`TextInjector` 增加 dry-run 模式**：`InjectionMode` 加 `.dryRun`，
   `smartInject` 返回将注入的文本而不产生副作用。
3. **`RelayAPIClient` 解析 usage**：从响应里取 `usage` 字段，随结果向上传递并落盘。
4. **（Phase 3）app 内置 test hook**：仅 debug build 启用，供 Lane A1 驱动。

> 原则：主功能代码零行为变化；testlab 删除后主项目不受任何影响。

---

## 4. testlab 项目结构（已落地）

```
testlab/
  README.md
  config.yaml            # 各阶段模型（全部 OpenRouter）、key 外置、并发数、价格表
  lab.py                 # CLI：plan / run / judge / all
  plans/                 # 生成的测试计划（YAML，入库；含 prerequisites）
  cases/                 # 手写 suite（dictation-smoke.yaml 为起步冒烟集）
  assets/audio/          # TTS 产物缓存（.gitignore，大文件不入库）
  runs/<timestamp>/      # 每次运行：suite 快照 + results.jsonl + report.md（不入库）
  src/
    config.py            # 配置加载 + key 解析（env 优先，其次 key_file）
    openrouter.py        # chat completions + TTS 客户端
    plan_gen.py          # ① 目的 → 计划（含 prerequisites、成本预估）
    tts.py               # ② OpenRouter TTS → afconvert → 16kHz WAV，内容寻址缓存
    runner.py            # ③ Lane B：TTS 合成 + 并发调 RelayTestRunner → results.jsonl
    judge.py             # ⑤ 逐 case judge（rubric + ASR 对照转写 → 归因标签）
    analyze.py           # ⑤ 聚类失败模式 → 定位环节 → 优化建议
    report.py            # Markdown 报告
    cost.py              # 预估（case 数 × token profile 均值）与实际 usage 核算
```

### Plan 生成的 context 架构（活的项目画像）

生成靠谱计划的前提是了解项目现状，且这份了解必须随项目演进。三层设计：

1. **`testlab/PROJECT_PROFILE.md`**：由 agent（Claude Code）阅读主仓库代码生成的
   **可测能力画像**——按测试维度（意图路由/记忆/输出质量/指令执行/QA/鲁棒性）组织，
   含每个能力的触发方式、配置开关矩阵、已知薄弱点、近期热点。带 `profile-commit` 戳。
2. **新鲜度检测**：`plan_gen.staleness()` 对比画像 commit 与 HEAD，落后超过
   15 个 commit 时 CLI/UI 都会告警，刷新流程见 `testlab/PROFILE_REFRESH.md`。
3. **生成时注入**：画像 + `git log -15`（测试重点跟着改动走）+ 测试目的一起进 prompt。

**去循环化原则**：system prompt 是被测对象之一，不是真值标准。case 的 rubric 锚定
"用户合理期望"；judge 新增 `spec_issue` 归因——输出符合 prompt 条文但违背用户期望时，
结论是"规范本身有问题"（judge 的输入里包含 dump 出的实际 system prompt 用于比对）。

### prerequisites 机制

plan 生成时由模型列出执行所需的外部条件（OpenRouter key、特定测试账号、
真实历史语料等），每项 `{id, description, status: pending}`。`lab.py run`
执行前检查：存在 `status != done` 的项即拒绝执行并打印清单，用户补全后把
status 改为 `done` 才能跑。

### TTS 策略（云端，统一走 OpenRouter）

| 层 | 引擎 | 用途 |
|---|---|---|
| 主力合成 | OpenRouter `/api/v1/audio/speech`（gpt-4o-mini-tts / Gemini TTS / Voxtral，`config.yaml` 可换） | 全部 case；多音色/语速由 case 的 `tts` 字段控制 |
| 格式归一 | macOS `afconvert`：mp3 → 16kHz 单声道 WAV（与录音管线同格式），按 (模型,音色,语速,文本) 内容寻址缓存 | 零额外依赖 |
| 环境扰动 | ffmpeg 叠加噪声（咖啡馆/键盘声）、音量抖动（Phase 2+ 可选） | 鲁棒性专项 |
| 真人语料 | InputHistory 导出的历史音频（脱敏后） | 校准 TTS 偏差的金标集 |

### Judge 与收敛

- **逐 case judge**：输入 = rubric + 最终输出 + ASR 对照转写 + context；
  输出 = pass/fail + 失败归因标签（`asr_error` / `prompt_violation` /
  `punctuation_format` / `hallucination` / `intent_misroute` / `vad_gate` / `latency`）。
  有 ASR 对照转写，归因能落到具体环节而不是笼统的「输出不对」。
- **聚合分析 agent**：对所有 fail 聚类 → 总结失败模式 → 关联到代码位置
  （prompt 段落 / VAD 阈值 / 路由规则）→ 产出可执行建议，prompt 类问题直接给出 diff 草稿。
- **回归对比**：每次 run 与上次基线 diff，新增 fail / 修复 / 退化一目了然。

### 成本控制

- plan 阶段按「case 数 × 历史 token 均值 profile」预估，超过阈值先确认再跑。
- run 结束用真实 usage 核算，更新 profile，预估越跑越准。
- judge 用便宜模型（分类任务），聚合分析才用强模型。

---

## 5. 分阶段路线

| Phase | 内容 | 交付物 | 状态 |
|---|---|---|---|
| **0** | 主仓库手术：Package 拆分（VoiceInputCore/VoiceInputMac/RelayTestRunner）+ TextInjector dry-run + usage 记录 | `RelayTestRunner` 吃 case JSON 吐 result JSON | ✅ 完成，端到端冒烟通过 |
| **1 (MVP)** | 后台车道跑通：手写听写 case → 云 TTS → runner → 结果落盘，人工评一轮验证保真度 | 第一份 results.jsonl + 人工标注对照 | 🔄 骨架已落地（cases/dictation-smoke.yaml），待跑首轮并人工核对 |
| **2** | Plan 生成 + judge + 聚合分析 + 报告 + 成本预估/核算闭环 | 「一句话目的 → 完整报告」端到端 | 🔄 代码已就绪（lab.py plan/judge/all），待实测调优 prompt |
| **3** | 前台车道 A1：test hook + 真实注入 + Agent 执行 + AX 读回验证 | agent 类 case 可自动回归 | 未开始 |
| **4** | A2 全真冒烟（BlackHole + 热键）+ 真人录音回归集 | 发版前冒烟清单 | 未开始 |

---

## 6. 开放问题（后续迭代再定）

- Lane A 执行 agent 动作的**沙箱问题**：真实执行会发邮件/建日历，需要测试账号
  或动作白名单（先限定到备忘录/日历等可清理的动作）。
- 真人录音集的脱敏与存放（不入库，本地目录 + 索引文件入库）。
- judge 的 judge：定期抽样人工复核 judge 准确率，防止评估器本身漂移。
- Android 侧复用：①②⑤ 模块平台无关，runner 层未来可加 adb 驱动的 Android lane。
