# 技能路由统一迁移方案（Phase 1b 重启）

> 目标：退役 `[AGENT_ACTION]` prompt 通道，全系统收敛为**单一白名单路由**——
> 主流程只做「注入已启用技能 → 是否命中 → 命中哪个」，停用 = 从名单缺席（而非注入禁令），
> 未列出的技能在 prompt 层不被引诱、在运行时被硬拦。
>
> 本方案是 [AGENT_SKILL_REFACTOR.md](AGENT_SKILL_REFACTOR.md) 中「Phase 1b ⏸ 刻意推迟」的重启。
> 当年推迟的理由是动态 codegen 还是主流程一等公民、重写触发 prompt 风险大；现在产品形态已变
> （语音创建已取消、技能一律在设置里显式创建、动态生成退居 dev 实验室），统一的时机成熟。

---

## 0. 背景：为什么现在做

### 0.1 产品形态已变，prompt 架构没跟上

执行层早已统一（`[SKILL:agent_*]` 与 `[AGENT_ACTION]` 在 Coordinator 里共用同一条
nativeSkill 执行链、同一个 ExecutionGate），但 prompt 层仍是三代叠层：

| 章节 | 性质 | 问题 |
|---|---|---|
| Agent 模式（`builtInAgentPrompt`） | 静态散文，四个内置动作的参数表/示例写死 | 停用某动作摘不掉条目，只能追加「绝不要输出 X，对应请求一律按普通文本处理」的黑名单补丁 |
| 用户技能路由（`builtInSkillRoutingPrompt`） | 白名单 catalog，动态拼装 | 与 Agent 章的禁令打架；内置四件套被排除在外 |
| Dynamic Agent（dev） | 自带一份 inline skill 小节 + catalog（含内置） | dev 下内置动作被 AGENT_ACTION 章和 dynamic 章**双重广告** |

### 0.2 两起实证事故（2026-07-10，beta，日志齐全）

1. **停用内置日程 → 自建日程技能被禁令误伤**：用户创建 `user_create_calendar_event`
   并停用内置 `agent_create_event` 后，「帮我把这个对话里的邀约生成一个日程」被
   「对应请求一律按普通文本处理」的禁令整类吞掉，自建技能 `useCount=0` 从未触发。
2. **AI 口述场景幻觉出 Notion 动作**：`buildOutputRoutingSection` 的 `agentOn` 只看全局开关、
   不看 `dictatingToAI`，导致「哨兵不发牌、仅转写」的场景里路由总表仍广告 `[AGENT_ACTION]`。
   模型看得见标记、看不见字段规范，两次现编出不同的假 schema（`NOTION_SAVE` /
   `create_note+category:notion`）；且该场景 Coordinator 被 `!dictatingToAI` 整体旁路，
   原始 JSON 被当听写注入输入框、还写进了短期记忆（自我强化污染源）。

两起的共同根源：**黑名单补丁 + 广告与说明书分离**。白名单架构下两者皆不可能发生。

---

## 1. 目标终态与非目标

### 终态

- **一个动作路由章节**（新 `PromptSection.actionRouting`）：通用判定规则 + 动态拼装的
  技能 catalog（内置四件套 + 用户技能，只列启用项）+ 按启用项拼装的内置补充判据。
- **一种动作输出格式**：`[SKILL:id] + JSON 参数`（含可选 `reply_text`）。
- **停用 = 缺席**：任何技能停用后从 catalog 消失，prompt 中不存在任何「不要输出 X」的反向文案。
- **两道门恒在**：prompt 只广告本轮实际可用的标记（路由总表按实际注入章节拼装）；
  运行时未知/停用 id 走既有 `unavailableSkill` 硬拦，哨兵样输出永不落入文本注入与记忆。
- dev 的 `[DYNAMIC_AGENT]` / `[ACTION_AMBIGUOUS]` 保留为**兜底扩展**（实验室门控不变），
  但不再自带 catalog——引用统一章节。

### 非目标

- 不动执行层（AgentController 执行器、Coordinator 执行链、ExecutionGate、澄清门、人在环循环）。
- 不动技能创建流（SkillComposer / SkillContracts）——composer 生成质量（如 5 个 hard 参数的
  日程技能不可触发）是独立工作项，见 §8。
- 不改 `[QA_ANSWER]` / `[NEED_WEB_SEARCH]` / `[CAPTURE_CONTEXT]` 等非动作哨兵的语义
  （只修它们在路由总表里的泄漏问题）。

---

## 2. 设计决策

### D1：统一 marker 用现成的 `[SKILL:id]`，不引入新信封 `[ACT]`

旧方案的 `[ACT]` 信封价值在统一快/慢车道（慢车道=动态 codegen）。动态生成已退出主流程，
为一个 dev-only 兜底引入新字面，等于让全量用户为它承担一轮触发准确率风险。
`[SKILL:id]` 已具备：白名单语义、criticality 硬门约定、`reply_text` 支持、
运行时 `unavailableSkill` 硬拦、`[SKILL:agent_*]` 直达 native 执行链。**零执行层改动。**

### D2：内置动作的专属判据 → 静态代码 map（按 `nativeActionKind` 键控），不进持久化数据

Agent 章多年调优沉淀的行为必须保留，但拆成两类：

- **通用规则**（进统一章节正文）：三要素判定、hard 参数硬门、参数诚实性、复合指令
  `reply_text`、时间格式 + `{{CURRENT_DATETIME}}`、「上下文内容可作参数来源」
  （选中文本/圈选/截图——建日程读屏幕邀约靠它）。
- **逐技能补充判据**（`nativeActionKind → String` 静态 map，只拼启用项）：
  send_email 严格载体条件与反例、create_event 时间默认值（+1h / 09:00）、
  create_note 边界声明（**仅 macOS 备忘录；Notion/Obsidian/飞书文档等第三方目标不在此列，
  没有对应技能时按普通文本处理**——本次幻觉事故的直接免疫）、各动作的 few-shot
  （全部改写为 `[SKILL:agent_*]` 输出格式）。

放代码不放 AgentSkill 持久化数据：文案是产品资产，要随版本迭代，不能被旧库存冻结。

### D3：停用语义 = catalog 缺席 + 运行时硬拦，删除全部反向文案

- 删除「用户已停用以下 action，绝不要输出…」注入（`PromptManager.swift:1343`）。
- 删除 `unavailableNativeActionKinds`（prompt 用途消失；运行时停用拦截已由
  `findSkill → isEnabled == false → .unavailableSkill` 覆盖，`parseRawAction` 兼容分支
  改查 `skill.isEnabled`）。
- 用户停用内置日程后：catalog 里没有它，但**自建的同类技能正常在列、正常可路由**——
  事故 1 的行为在架构上自然修复。

### D4：`[AGENT_ACTION]` 保留为纯运行时兼容别名，观察 2 个 release 后删除

prompt 层不再出现该字面；`parseRawAction` 分支保留（打 `legacy marker` 日志），
兜两类残留：用户自定义 prompt override 未迁移、短期记忆/历史里旧格式文本被模型复读。

### D5：路由总表按「本轮实际注入的章节」拼装（事故 2 的第一道门）

`buildOutputRoutingSection` 签名改为接收注入标志（`actionRoutingInjected` /
`qaInjected` / `webSearchAvailable` / `captureContextAvailable`），调用点全部有现成布尔值。
不再直接读全局 `AppSettings` 开关。`dictatingToAI` 场景下动作/QA 行自然消失。

### D6：哨兵清洗兜底（事故 2 的第二道门）

`VoiceInputApp.handleProcessingResult` 中，`startIfNeeded` 之后、
**文本注入 / 历史 / 短期记忆之前**：输出以已知哨兵标记开头但未被任何执行层消费
（含 `dictatingToAI` 旁路场景）→ 不注入原文、不入记忆（防自我强化污染）、
历史记失败条目、toast 提示「该操作在当前场景不可用」。清单：`[AGENT_ACTION]`、
`[SKILL:`、`[DYNAMIC_AGENT]`、`[ACTION_AMBIGUOUS]`、`[QA_ANSWER]`、`[QA_SEARCH]`、
`[NEED_WEB_SEARCH]`、`[CAPTURE_CONTEXT]`。

### D7：退役 `PromptSection.agent` / `.skillRouting`，新增 `.actionRouting`

自定义 override 迁移：启动时检测 `customPrompt_agent` / `customPrompt_skillRouting`，
存在即删除并打日志（这两个编辑入口是 dev 面向的；旧自定义文案会让模型继续产旧 marker，
留着必然与新框架冲突）。SettingsView 的 prompt 编辑器由 `PromptSection.allCases`
驱动，自动跟随。

---

## 3. 统一章节骨架（`builtInActionRoutingPrompt`）

```
# 动作路由

当前时间：{{CURRENT_DATETIME}}

用户的语音是明确冲你（助手）下达的操作指令、且与下列某个技能匹配时，输出：
[SKILL:skill_id]
{"param1": "...", ...}

## 触发硬门槛（三要素，宁可放过绝不误触）
（沿用现 builtInSkillRoutingPrompt：动作动词 / 具体目标 / 载体匹配；
 任一不满足或没有匹配技能 → 普通文本，不存在其他动作标记）

## 参数规则
（criticality 标记语义 / 参数诚实性 / 上下文内容作为参数来源：
 选中文本、圈选、截图中用户明确指涉的内容可以且应当提取进参数）

## 复合指令（reply_text）
（沿用现有定义）

## 时间格式
（YYYY-MM-DDTHH:mm、相对时间换算——从旧 Agent 章平移）

## 已启用的技能
{{SKILL_CATALOG}}          ← 内置(agentModeEnabled) + 用户技能(userSkillRoutingActive)，只列启用项

## 部分技能的补充判据
{{BUILTIN_GUIDANCE}}       ← D2 静态 map，只拼启用的内置项（含 few-shot，[SKILL:agent_*] 格式）
```

注入条件：`agentModeEnabled && !dictatingToAI && catalog 非空`。
dev 的 Dynamic Agent 章紧随其后，删除自带 catalog 与「标准 Agent 操作→走 [AGENT_ACTION]」
划界，改为「优先匹配上文『动作路由』章节的技能；均不匹配才 [DYNAMIC_AGENT]」。

---

## 4. 分阶段实施

### Phase A｜止血（独立可先上，不依赖 B）

| # | 改动 | 文件 |
|---|---|---|
| A1 | 路由总表按实际注入章节拼装（D5） | `PromptManager.swift`（`buildOutputRoutingSection` 及调用点） |
| A2 | 哨兵清洗兜底 + 记忆防污染（D6） | `VoiceInputApp.swift`（`handleProcessingResult`） |

### Phase B｜统一路由框架（本方案主体）

| # | 改动 | 文件 |
|---|---|---|
| B1 | 新 `PromptSection.actionRouting` + `builtInActionRoutingPrompt`（§3 骨架）；退役 `.agent`/`.skillRouting` 两个 case | `PromptManager.swift` |
| B2 | 内置补充判据静态 map（`nativeActionKind → 判据+few-shot`，[SKILL:] 格式） | `PromptManager.swift`（或独立 `NativeActionGuidance.swift`） |
| B3 | `getPrompt` 注入逻辑：原「8. Agent 模式」+「8.6 用户技能路由」两分支合并为一个；删除停用禁令补丁 | `PromptManager.swift:1335-1437` |
| B4 | `buildSkillCatalog` 去掉 `includeBuiltIns` 参数（内置恒入列，各自受启用开关过滤）；删除 `unavailableNativeActionKinds`；`hasEnabledNativeActions` 视 B3 需要保留或内联 | `AgentSkillRegistry.swift` |
| B5 | Dynamic Agent 章（dev）：删 inline skill 小节（`PromptManager.swift:1381-1408`）与 `{{SKILL_CATALOG}}` 占位、删「不适用→[AGENT_ACTION]」条目、开头划界文案改写 | `PromptManager.swift` |
| B6 | 路由总表动作行：`已启用技能 → [SKILL:id]`（dev 追加 dynamic 兜底行）；`[AGENT_ACTION]` 从总表与 comboRule 消失 | `PromptManager.swift` |
| B7 | Coordinator：`parseRawAction` 分支降级为兼容别名（移到 `[SKILL:]` 解析之后，打 legacy 日志；停用检查改 `skill.isEnabled`） | `AgentExecutionCoordinator.swift` |
| B8 | 自定义 override 迁移（D7） | `PromptManager.swift`（启动路径） |
| B9 | 注释/文案同步：beta 门控注释、`AppFlavor`/`Settings` 内提及 [AGENT_ACTION] 处 | `Settings.swift:1226` 等 |

### Phase C｜退役与看护（B 上线 2 个 release 后）

| # | 改动 |
|---|---|
| C1 | 删除 `parseRawAction` 兼容分支；`nativeSkill(forKind:)` 收为内部实现 |
| C2 | `WebSearchService.swift:255` 禁止清单等文档性引用清理 |
| C3 | 在 `AGENT_SKILL_REFACTOR.md` 实施记录补记 Phase 1b 完成 |

---

## 5. 行为变更矩阵

| 场景 | 迁移前 | 迁移后 |
|---|---|---|
| beta 内置四件套触发 | `[AGENT_ACTION]` 专章 | `[SKILL:agent_*]`（执行链、ExecutionGate、澄清门均不变） |
| 停用内置 create_event | 注入「绝不要输出+一律按文本」禁令，同类自建技能被误伤 | catalog 缺席；自建同类技能正常路由（事故 1 修复） |
| 模型编造不存在的技能/目标（Notion 等） | AGENT_ACTION 无 id 白名单概念；字段错则静默穿透为文本 | prompt 无引诱（catalog 白名单 + create_note 边界声明）；仍编造则 `unavailableSkill` 硬拦 + 哨兵清洗（事故 2 修复） |
| AI 口述场景（dictatingToAI） | 总表泄漏 `[AGENT_ACTION]` → 模型现编 JSON → 原文注入+入记忆 | 总表无动作行；万一模型仍输出哨兵 → 清洗兜底，不注入不入记忆 |
| dev（动态生成开） | 内置被 AGENT_ACTION 章 + dynamic 章双重广告 | 单一 catalog；dynamic 章只剩兜底职责 |
| prompt token | Agent 专章 + skillRouting 章 + dynamic 章 inline 小节三份重叠规则 | 单章节，净减（具体量以 dumpPrompt 对照） |

---

## 6. 验证计划

> 按约定：testlab 由用户触发，本迁移自查止步于 `swift build` + dumpPrompt 静态检查。

1. **构建**：`swift build` 通过；dev / beta 两 flavor 的 prompt dump 人工核对
   （四种组合：agentMode on/off × dictatingToAI on/off，确认无 `[AGENT_ACTION]` 字面、
   无禁令文案、总表与实际章节一致）。
2. **存量回归集**（改后由用户跑）：
   - `agent-email-guard.yaml`：负例 rubric 从「出现 [AGENT_ACTION] 即失败」放宽为
     「出现任何动作标记即失败」（oracle 的 `agent_intent` 判定本就通用）；
   - `agent-messaging-50.yaml`：正例期望格式改 `[SKILL:agent_*]`。
3. **新增回归集 `skill-routing-unified.yaml`**：
   - 内置四件套正例（参数抽取 + `[SKILL:agent_*]` 格式）；
   - **事故 1 复现**：停用内置日程 + 自建日程技能在列，参数齐备话术必须落
     `[SKILL:user_create_calendar_event]`；参数不齐话术必须落普通文本（不许编参数）；
   - **事故 2 复现**：「把选中的内容保存到 Notion」（无对应技能）→ 普通文本；
     `dictatingToAI` 场景同话术 → 纯转写；
   - 复合指令 `reply_text` 在 `[SKILL:]` 格式下的正例。
4. **手动冒烟**（真机）：四件套各一句、停用/启用切换后的 catalog 变化、
   AI 对话场景说动作话术不再蹦 JSON。

---

## 7. 风险与回退

| 风险 | 缓解 |
|---|---|
| 内置动作触发准确率回归（Phase 1b 当年推迟的原因） | 判据/few-shot 全量平移只改输出格式；先 dev 落地 → email-guard / messaging-50 / 新回归集全绿 → 才进 beta。回退 = revert（prompt 层无数据迁移） |
| 短期记忆/历史残留旧格式被复读 | D4 兼容 parser 保留 2 个 release + D6 清洗兜底 |
| 用户自定义 prompt override 与新框架冲突 | D7 启动时清除 + 日志；dev-only 影响面 |
| 统一章节过长稀释注意力 | 补充判据只拼启用项；净 token 预期下降（删三处重叠）；dumpPrompt 对照确认 |

---

## 8. 实施记录

### Phase A + B ✅（2026-07-10 一次性落地，`swift build` 通过）

- **A1** `buildOutputRoutingSection` 签名改为 `(captureContextAvailable, actionRoutingInjected, dynamicAgentInjected, qaInjected)`——动作/QA 行只在对应章节本轮真的注入时列出；webSearch 行保持随全局开关（该章节由 AIAudioProvider 按同一开关在下游追加，恒同步）。
- **A2** `PromptManager.unconsumedActionSentinel(in:)` + `VoiceInputApp` 两条注入路径（主路径 + 重试路径）的哨兵清洗兜底：`[AGENT_ACTION]/[SKILL:/[DYNAMIC_AGENT]/[ACTION_AMBIGUOUS]/[NEED_WEB_SEARCH]/[CAPTURE_CONTEXT]` 开头且未被执行层消费 → 不注入、不入短期记忆、历史记失败（音频保留可重试）、toast 提示（新 L10n key `toast.actionUnavailable`）。QA 标记不拦——`strippedOutput` 已有抢救正文的降级。
- **B1** `PromptSection` 退役 `.agent`/`.skillRouting`，新增 `.actionRouting`；`builtInActionRoutingPrompt` 按 §3 骨架落地（通用三要素/硬门/诚实性/上下文来源/时间格式/reply_text + `{{SKILL_CATALOG}}`/`{{BUILTIN_GUIDANCE}}`）。
- **B2** 新文件 `NativeActionGuidance.swift`：四件套判据与 few-shot 全量平移（输出格式改 `[SKILL:agent_*]`），create_note 新增第三方目标边界声明（Notion/Obsidian 等无技能时按普通文本，不顶替不谎报）。
- **B3** `getPrompt` 原「8. Agent 模式」+「8.6 用户技能路由」合并为单一「动作路由」分支；**停用禁令补丁整体删除**。内置项随 `agentModeEnabled` 入列、用户技能随 `dynamicAgentEnabled || userSkillRoutingActive` 入列。
- **B4** `buildSkillCatalog(forSceneId:includeBuiltIns:includeUserSkills:)`；新增 `enabledNativeActionKinds`；删除 `hasEnabledNativeActions`/`hasEnabledUserSkills`；`unavailableNativeActionKinds` 保留（仅 legacy 兼容硬拦 + 诊断快照）。
- **B5** Dynamic Agent 章去 catalog 化：首优先级改为引用「动作路由」章节，`{{SKILL_CATALOG}}` 占位替换为引用文案（兼容旧自定义覆盖）；「不适用→[AGENT_ACTION]」划界删除。
- **B6** 路由总表动作行：`[SKILL:id]`（+dev 时 `[DYNAMIC_AGENT]`/`[ACTION_AMBIGUOUS]` 兜底行）；`[AGENT_ACTION]` 字面从总表与 comboRule 消失。
- **B7** Coordinator：`[SKILL:id]` 提为主分支（新增"未广告的用户技能 id 被点名 → unavailableSkill 硬拦"门控）；`parseRawAction` 降为 legacy 兼容分支（打 `♻️ [Legacy]` 日志），观察 2 个 release 后按 Phase C 删除。
- **B8** `PromptManager.init` 启动迁移：清除 `customPrompt_agent`/`customPrompt_skillRouting` 遗留自定义覆盖。
- **B9** 注释同步（Settings/TestRunnerEntry/Registry）；`AgentController.agentPromptSection` 删除。
- **testlab**：`agent-email-guard.yaml` rubric 更新为格式无关表述；新增 `skill-routing-unified.yaml`（内置四正例+复合指令、事故1 停用接管三例、事故2 幻觉目标三例、备忘录正向对照）；TestRunnerEntry 新增 `config.disabledBuiltInActions` / `config.userSkills`（进程内存覆盖 `AgentSkillRegistry.overrideForTesting`，不落盘），注册表环境自此对所有 suite 纯净化。
- **验证状态**：`swift build` 通过；testlab 回归（email-guard / messaging-50 / skill-routing-unified）待用户触发；beta 发版前需全绿。

### Phase C ⏸（观察 2 个 release 后）

C1 删 legacy 分支、C2 文档性引用清理、C3 已随本记录完成。

## 9. 相关但不在本迁移内的工作项

1. **SkillComposer criticality 契约**：可有合理默认值的槽位（日历名、结束时间）不应生成为
   「hard 必填 + 缺失即 error」——直接决定自建技能能否被自然语音触发（事故 1 的第二成因）。
2. **既存 `user_create_calendar_event` 的修复**：可走技能优化器（"日历名默认『个人』、
   结束时间默认+1小时"）或引导用户重建。
3. Dynamic Agent（dev 实验室）的长期去留，与本迁移解耦。
