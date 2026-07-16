# Agent / Skill 重构方案（macOS / relay）

> 目标：把现有「日程/提醒/备忘 + 动态 Skill + 动态 codegen」三套并行链路，
> 收敛成一个统一的 Capability 管线，提升生成稳定性与人在环交互，并打通 OS Runtime，
> 推进产品化。

---

## 0. 现状诊断（基于现有代码）

主转写 AI 在一次输出里会吐三种 marker，对应三条**互不相通**的解析/执行链：

| Marker | 解析方 | 执行方 | 能力来源 | 学习 | 是否经统一管线 |
|---|---|---|---|---|---|
| `[AGENT_ACTION]` | `AgentController` | 硬编码 Swift（EventKit / Gmail URL / Notes AppleScript） | 4 个写死动作 | ❌ | ❌（直连，绕过 Coordinator） |
| `[SKILL:id]` | `AgentSkillRegistry` | 模板渲染 → `DynamicAgentController` | 内置 + 自学习模板 | ✅ | ✅ |
| `[DYNAMIC_AGENT]` | `DynamicAgentController` | 动态 codegen + self-repair | 现场生成 | ✅ 成功后 promote | ✅ |

关键问题：

1. **`[AGENT_ACTION]` 绕过统一入口**。`VoiceInputApp.swift:291` / `:1291` 直接
   `AgentController.shared.parseAction → execute`，没经过 `AgentExecutionCoordinator`，
   因此日程/提醒/备忘/邮件享受不到 `ExecutionGate`、self-repair、history、风险分级。
2. **能力被切成两个注册表**：`AgentController` 4 个动作是代码常量；`AgentSkillRegistry`
   是可增删 skill。prompt 里要专门写「标准 Agent 操作不要走 DYNAMIC_AGENT」手动划界
   （`PromptManager.swift` builtInAgentPrompt vs builtInDynamicAgentPrompt）。
3. **交互只有二元确认**。`OverlayWindowController.requestConfirmation`
   （`DynamicAgentController.swift:1791`）只能「执行/取消」。意图模糊时唯一策略是
   prompt 里「拿不准一律按普通文本」——要么猜、要么放弃，没有反问/补槽位/草稿确认。
4. **Runtime 上下文很浅**。只有 `NSWorkspace.frontmostApplication`、`scanInstalledApps()`
   的静态安装目录、前台 app 的 AX focused window。**没有**运行进程枚举、多窗口列表建模、
   窗口/会话可寻址句柄。所以「把内容注入到指定窗口」无法表达。

---

## 1. 已拍板的设计决策

### D1：双车道路由（合并范式，且不牺牲高频动作延迟）

对外只有一个统一信封 `[ACT]`，但内部分两条车道：

- **快车道（0 次额外模型调用）**：主转写 pass 直接给出 `skill_id` + 抽好的参数。
  native action 与「hard 参数齐全的已学习 skill」命中后直接执行，延迟等同今天的 `[AGENT_ACTION]`。
- **慢车道**：信封里只有自然语言 intent（= 今天的 `[DYNAMIC_AGENT]`）→ router → codegen → self-repair。

`[AGENT_ACTION]` 保留为一个 release 的兼容别名，平滑迁移。

### D2：结构化上下文为主，像素为机会性增强，永不作为前置硬依赖

窗口/进程/会话路由全部走确定性元数据，**不依赖截图/屏幕录制**：

| 信息 | 拿法 | 权限 | 碰像素 |
|---|---|---|---|
| 窗口列表（app / pid / **window id** / bounds / layer） | `CGWindowListCopyWindowInfo` | 无 | 否 |
| 窗口标题（消歧用） | AX `AXUIElementCreateApplication(pid)` → `kAXWindowsAttribute` → `kAXTitleAttribute` | 辅助功能 | 否 |
| 运行 app / 进程 | `NSWorkspace.runningApplications` | 无 | 否 |

> `CGWindowList` 仅「取窗口标题 `kCGWindowName`」才需屏幕录制；我们用 AX 拿标题绕开它。
> 现有截图 / OCR / ambient vision（`ScreenshotManager`、`ambientVisionActive`、圈选）保持
> 「可选开关」定位：有则增强，无/不准则优雅降级，Agent 决策不因单帧识别失败而崩。

---

## 2. 目标架构

### 2.1 统一 Capability 模型（解决 area 一）

给 `AgentSkill` 加 backend 维度，把原生动作纳入同一抽象：

```swift
enum SkillBackend {
    case nativeAction(NativeActionKind)   // create_event / create_reminder / create_note / send_email
    case shell
    case appleScript
    case urlScheme
}
```

- `AgentController` 的 4 个动作 → 注册为 `isBuiltIn` native skill，参数复用 `SkillParam` + `criticality`
  （`recipient_name=.hard`、`subject/notes=.soft`），直接复用 `ExecutionGate` 硬门。
- 新建 `NativeActionExecutor`，把 `AgentController` 的 EventKit/URL/AppleScript 执行逻辑原样搬入。
- 结果：日程/提醒/备忘并入 `AgentExecutionCoordinator`，自动获得 ExecutionGate / history / 风险分级 / self-repair。

### 2.2 双车道路由

- 统一信封 `[ACT]`，路由判据合并到一处（删除手动划界 prompt）。
- Coordinator `Request` 增加 `.nativeAction` / `.skill` / `.dynamic` 三态，快车道命中直接执行。

### 2.3 单一权威的 Gate / 风险 / history

native backend 也走同一套 `assessRisk` / `recordSuccess` / `recordFailure`。完成 2.1 后自动达成。

---

## 3. 稳定性 + 人在环（解决 area 二）

现有生成 = 一次性 codegen + 最多 2 次 self-repair + 失败 silent。缺「预检反问」与「可监控固化」。

### 3.1 Preflight 澄清门（codegen 之前）

命中任一条件就**反问用户，而非猜测**：
- 某 `.hard` 参数缺失或为模糊代词（ExecutionGate 已能识别「对方/他/那个」）；
- Runtime 有**多个候选目标**（多个同名窗口 / 多个会话）；
- router 置信度低 / 多个 skill 都像。

### 3.2 交互原语从「二元确认」扩成三种

扩展 `OverlayWindowController`：
1. **pick-one**：从候选选（哪个窗口 / 联系人 / 项目目录）；
2. **fill-slot**：补一个缺失 hard 槽位（语音或输入）；
3. **confirm-plan**：执行前展示人话计划（不是 raw script）。

### 3.3 把「生成 skill」固化成被审阅的流水线

```
Plan → (Clarify) → Generate → Validate → Dry-run/Preview → Confirm → Execute → Verify → Promote(草稿确认)
```

- promote（`DynamicAgentController.swift:906`）从**静默沉淀**改为**弹「skill 草稿确认」**：
  用户命名、确认作用域（global/scene）、批准成为永久能力。
- self-repair 用尽后从「降级文本」改为「升级澄清」：告诉用户卡在哪、缺什么。

### 3.4 监控「是否符合预期」

- 给 `AgentSkill` 加 `successCount / failureCount` + 可靠性分；低分自动标记待复审 / 降级，不再无脑复用。
- history 加一次点击的「这次对不对？」反馈，把「技术成功」与「用户满意」分开记。

---

## 4. Runtime 打通（解决 area 三）

新建 `RuntimeContextProvider`：按需快照、TTL 缓存、权限分级、像素无关（见 D2）。

| 上下文 | API | 现状 |
|---|---|---|
| 已安装 app | `scanInstalledApps()` | ✅ 有，但只喂 codegen，没进意图学习 |
| 运行中进程/app | `NSWorkspace.runningApplications` | ❌ 补 |
| 多窗口列表（含 windowID/bounds） | `CGWindowListCopyWindowInfo` | ❌ 补（截图用过一次，未建模） |
| 焦点窗口/元素 | AX（散落在 `SceneManager` / `MemoryV2Engine`） | 🟡 收口 |
| 会话 | app 专属：终端 cwd、浏览器 tab url、Claude Code session | ❌ 补 |

要点：
1. **可寻址句柄**：窗口带 `windowID`/`pid`，codegen 才能「激活 window X 再注入」。
   扩展 `TextInjector`（现仅注前台）支持「按 window id 激活后注入」。
2. **隐私/性能**：惰性采集、脱敏窗口标题、默认仅在「澄清需要」或「用户明确跨窗口」时全量。
3. 快照同时喂 router（消歧）与 codegen 的 `buildCapabilityManifest`（现仅静态安装目录，
   加上「当前开着哪些窗口/会话」）。

---

## 5. 落地路线（按风险递增，可独立上线）

- **Phase 0｜统一执行路径**（近零行为变更）：`[AGENT_ACTION]` 改为经 `AgentExecutionCoordinator`。
- **Phase 1｜能力合并 + 收 marker**：4 原生动作注册为 native skill；`[ACT]` 信封 + 双车道；旧 marker 留兼容别名。
- **Phase 2｜人在环**：Preflight 澄清门 + 三种交互原语 + skill 草稿确认。
- **Phase 3｜Runtime**：`RuntimeContextProvider`（运行 app / 窗口 / 会话）+ 窗口寻址注入。
- **Phase 4｜可靠性闭环**：skill 可靠性分 + 满意度反馈 + 低分复审。

---

## 6. Phase 0 实施计划（文件级）

目标：把 `[AGENT_ACTION]` 收口进统一管线，**行为不变**，但 4 个原生动作开始享受
history / overlay / 风险分级。改动小、可回退。

### 6.1 `AgentExecutionCoordinator.swift`
- `Request` 枚举增加 `case nativeAction(AgentAction)`。
- `parseRequest(from:)`：在 dynamic-intent 兜底之前，尝试 `AgentController.shared.parseAction(from:)`，
  命中则返回 `.nativeAction`。
- `start(_:context:)` 增加 `.nativeAction` 分支 → 新增 `runNativeAction(_:context:)`：
  调用 `AgentController.execute`，把 `AgentResult`（success/partialSuccess/failure）映射到现有
  `recordSuccess` / `recordFailure` / overlay toast / `scheduleHide`，与 skill/dynamic 分支一致。

### 6.2 `AgentExecutionCoordinator.startIfNeeded(from:context:)`
- 当前 guard 仅 `AppSettings.shared.dynamicAgentEnabled`。改为
  `dynamicAgentEnabled || agentModeEnabled`，否则关掉 Dynamic Agent 时 native action 会漏接。

### 6.3 `VoiceInputApp.swift`（两处：`:291` 附近、`:1291` 附近）
- 删除直连 `AgentController.shared.parseAction → execute` 的分支，统一交给
  `AgentExecutionCoordinator.shared.startIfNeeded(...)`（已在 `:321` / `:1322` 调用）。
- 确认两个调用点的 `Context.historyMode`（append vs update）语义对 native action 同样成立。

### 6.4 验证
- 「提醒我明天 10 点买牛奶」「记一下会议纪要」「明天下午两点和张三开会」三类话术：
  - 仍正确创建提醒/备忘/日程（EventKit / Notes / Google Calendar 逻辑未改）；
  - history 出现统一格式条目；overlay 出现统一 toast；失败时走统一失败反馈。
- 关闭 Dynamic Agent、仅开 Agent 模式时，native action 仍可触发（验证 6.2）。

### 6.5 不在 Phase 0 范围
- 不动 `AgentSkill` 数据结构（backend 维度留到 Phase 1）。
- 不合并 marker（`[ACT]` 留到 Phase 1）。
- 不碰 prompt 划界文案（Phase 1 一起改）。

---

## 7. 实施记录

### Phase 0 ✅
- `[AGENT_ACTION]` 收口进 `AgentExecutionCoordinator`（新增 `.nativeAction`），
  删除 `VoiceInputApp` 两处直连。原生动作获得统一 history / overlay / 失败反馈；
  失败不再被误记为成功。`startIfNeeded` guard 放宽为 `dynamicAgentEnabled || agentModeEnabled`。

### Phase 1 ✅（能力 + 执行层统一）
- `AgentSkill` 增加 `nativeActionKind`（`scriptType="native_action"`、无模板），
  `isNativeAction` / `hasValidParameterTemplate` 对原生动作放行。
- 注册 4 个原生动作内置 skill：`agent_send_email` / `agent_create_event` /
  `agent_create_reminder` / `agent_create_note`，参数带 `criticality`（title/recipient/start_time 为 hard）。
- `AgentController.makeAction(kind:params:)` 桥接 `(kind, params) → AgentAction`，
  `[SKILL:agent_*]` 与旧 `[AGENT_ACTION]` 共用同一执行器。
- Coordinator 新增 `.nativeSkill`：先过 `ExecutionGate` 硬门（如「建提醒」无标题会干净 bail），
  再执行。`routeIntentToLearnedSkill` 排除原生 skill（其无 `GeneratedScript`）。
- 现在原生动作出现在 skill catalog，可经统一 `[SKILL:]` 路径触发；`[AGENT_ACTION]` 作为兼容别名共存。

### Phase 3 ✅（Runtime 打通，结构化、无截图）
- 新增 `RuntimeContextProvider`：`NSWorkspace.runningApplications`（运行 app）+
  `CGWindowListCopyWindowInfo`（在屏窗口 owner pid，layer 0；无需屏幕录制）+
  AX `kAXTitleAttribute`（窗口标题，仅辅助功能权限）。短 TTL 缓存。
- `buildCapabilityManifest`（codegen 慢车道）附带「当前运行的应用 + 窗口标题」段，
  受新设置 `runtimeContextEnabled`（默认开）控制；纯结构化元数据，不含截图。
- `TextInjector.focusWindow(ownerPID:titleContains:)` / `injectIntoWindow(...)`：
  按结构化窗口标题用 AX raise + activate 前置目标窗口再注入，无屏幕坐标/截图。
- 隐私：窗口标题会随 codegen prompt 发往云端模型（与既有 scene/OCR 上下文同级）；
  可经 `runtimeContextEnabled` 关闭。SettingsView 开关待补（仅落了 Settings key + gate）。

### Phase 4 ✅（可靠性闭环）
- `AgentSkill` 增加 `successCount` / `failureCount`，派生 `successRate` / `isLowReliability`
  （仅自学习 skill；攒够 4 次样本且成功率 < 40% 才判低可靠，内置永不降级）。
- `AgentSkillRegistry.recordOutcome(skillId:success:)`：在 Coordinator 的 skill /
  原生 skill 执行后调用，记录成败。
- `availableSkills` 过滤掉低可靠的自学习 skill → 不再进 catalog / router 自动复用，
  降级走动态重新生成（skill 仍保留在列表，可在设置里手动修复/删除）。

### Phase 2 ✅（人在环交互）
- ✅ **skill 草稿确认**：`autoSaveAsSkill` 保存全新自学习 skill 前弹确认，受 `skillDraftConfirmEnabled`（默认开）控制。
- ✅ **三种交互原语**（复用灵动岛 overlay 框架）：
  - `OverlayWindowController.requestConfirmation`（confirm-plan，已有）
  - `requestChoice(title:options:) -> Int?`（pick-one，鼠标单选）
  - `requestTextInput(title:detail:placeholder:) -> String?`（fill-slot，文字输入）
  - 窗口改为 `OverlayPanel: NSPanel`（`.nonactivatingPanel` + `becomesKeyOnlyIfNeeded`）：
    TextField 能接收键盘，但不抢应用级焦点。语音补槽暂缓，先用文字输入。
- ✅ **Preflight 澄清门**：`AgentExecutionCoordinator.clarify()` —— 当 `ExecutionGate`
  判定某 hard 参数缺失/模糊时，不再直接 bail，而是先问用户：窗口/会话型参数（Runtime 有真实候选）
  走 pick-one，其余走 fill-slot；补齐后重新过门再执行，用户取消才回退到原 bail。
  接进 `runNativeSkill` 与 `runSkill` 两条路径。
- `ExecutionGate.firstInvalidHardParam` 定位要问哪个槽位。
- ⏸ 仍待：SettingsView 开关 UI（runtimeContext / skillDraftConfirm）；语音补槽（后续完善）。

### 首轮验收反馈与修复
- **灵动岛层级回归**：overlay 换 NSPanel 时误设 `isFloatingPanel=true`（会把 level 重置成
  `.floating`），导致掉到菜单栏下方。已移除，level 改在面板属性后设置。
- **凭空补全参数**（"把刚才那句生成日程" → 冒出没提过的人名/地点）：AGENT_ACTION /
  DYNAMIC_AGENT prompt 加「诚实性硬规则」——事实性槽位只能来自用户本次语音/明确引用内容，
  背景信息（档案/记忆/词典）只能消歧不能无中生有。

### 灵动岛收起"卡一会儿"/点"不保存"后变黑块
- 真因（用户澄清）：草稿确认（"保存为技能?"）排在**结果展示之前**——点完按钮 `finishConfirmation`
  先 `hide()` 开始收起，但紧接着 `runDynamicIntent` 又 show 了结果 toast，导致"收起途中又展开"
  （中间帧就是黑块）+ 再等延时才真收起。
- 修复：把技能学习（含草稿确认）从 `processIntent` 内部移出，改为 `runDynamicIntent` 在
  **结果展示之后**调用 `DynamicAgentController.learnSkillFromSuccess(...)`。草稿确认成为收尾交互，
  点完（保存/不保存）即收起，之后不再有二次 show。`processIntent` 不再内嵌 autoSave。
- 顺带：结果/失败 toast 收起延时 5s/4s → 统一 `hideDelay = 2.5s`（取消仍 2s）；promote 网络
  调用前显示「正在整理技能…」避免停在旧 toast 上像卡住。

### #2 边界（校准版）
- **chat-send / 把内容发到某 app 的某会话 = 核心 IN-scope 价值**（GO/CLARIFY），不是 DECLINE。
- DECLINE 只收**开放式 / 不可验证 / 需反复判断**的任务（"重构项目""整理邮箱"）。
- Telegram 那个 case 是**可靠性问题**不是范围问题。可靠性靠：
  1. **消灭静默成功**：codegen prompt 加硬规则——禁止用 `display dialog "已发送/已完成"`
     冒充成功；"成功"必须验证真实终态；发送/粘贴正文前必须先确认目标会话真的打开了，否则 `error`。
  2. **失败要响 → 自修复接管**（已有自修复循环），不要一次猜错就硬走到底。
  3. **只学验证成功的**：promotion 只在真 `result.success` 触发（消灭静默成功后才可信）。
  4. **用户当成功裁判**：新技能保存前的草稿确认文案改为"这次执行符合预期吗？符合才保存复用"。
  5. **不预填没把握的快捷键**（那等于又在猜）；让正确路径从"验证过的成功"里沉淀。
- 体现用户原则：把确认/验证成本前置到 skill 创造阶段，宁多问不猜；一旦真成功沉淀成 skill，复用即稳。

### 设置 UI 易用化 + "学会后怎么用"
- 用户反馈：Dynamic Agent / Skills 设置太技术、名字难懂。重新设计：
  - **「Agent 模式」+「Dynamic Agent」两个 section 合并成一个「语音技能」**，单一总开关
    （`voiceSkillsEnabledBinding` 同时开关底层 agentMode + dynamicAgent）；大白话 caption + 用法示例。
  - 开发者配置（OpenRouter 模型名/常用模型/链接 + 扫描应用清单 `DynamicAgentCapabilityView`）
    收进默认折叠的**「高级设置」**；beta flavor 本就不展示本区。
  - 技能列表去技术化：不再露脚本类型/参数名/BUILT-IN/×次数；改为「它学会的技能」——
    每条友好名 + **「说『…』」用法示例** + 删除；内置技能默认折叠。
  - 「高级」内补上 `skillDraftConfirmEnabled`（学会新技能前先问我）/ `runtimeContextEnabled`
    （把窗口信息给模型）两个开关。
- **"学会后怎么用"**：`AgentSkill.exampleUtterance`（内置手写、自学习由归纳模型产出 `example` 字段）；
  草稿确认弹窗加一句「以后说『…』就行」；技能列表每条展示「说『…』」。

### 职责分工：前置出"内容"，codegen 只做"动作"（重要架构原则）
- 反例：圈选英文说"翻译成中文存 Notion"。前置多模态模型本可直接翻译，却只把*任务*塞进 intent；
  codegen（纯文本、看不到屏幕）于是现场重造 `screencapture + Vision OCR + mymemory 翻译 API`，
  又脆又把上游做过的事重做。skill 的真正价值只在"存 Notion"。
- 原则：**前置多模态模型 = 出内容**（理解/OCR/翻译/总结/提取/改写，它本来就会）；
  **codegen/skill = 只做动作**（把内容投递到目标）。内容作为参数从前置带下来，不在脚本里重造。
- 落地：
  - `DynamicAgentIntent` 增加 `content` 字段；`parseIntent` 解析 `[DYNAMIC_AGENT]` 的 `content`。
  - 前置 prompt（builtInDynamicAgentPrompt）：`[DYNAMIC_AGENT]` JSON 加 `content`，明确"内容加工你现在做完、成品放 content，intent 只描述动作"。
  - codegen prompt 加「职责边界」段：内容已上游产出（见「已提供的内容」段），**严禁** screencapture/OCR/翻译API/网页抓取重造内容；脚本只投递；缺内容则报错不自造；沉淀 skill 时正文做成 `{{content}}` 参数。

### 目的地优先原生 App + 已验证快捷键（而非网页）
- 现象："存到 Notion" 走了 Chrome 开 `notion.so/new` + 固定 delay 盲粘贴（脆、易假成功），
  没走 Notion 桌面端 Cmd+N 新建页面这条稳定路径（与微信 Cmd+F skill 同类）。
- 纠错：模拟按键（System Events `keystroke`/`key code`）**不需要 AppleScript 字典**，对
  Electron 应用（Notion）照样有效；字典限制只针对 `tell application "X" to <命令>`。所以
  "没字典"不是放弃原生 App、改走网页的理由。
- 为什么没走：① `AgentInteractionKnowledge` 没有 Notion 的已验证快捷键（微信 Cmd+F 是种过的）；
  ② codegen prompt 缺"优先原生 App + 其快捷键入口、而非网页"的偏好。
- 已做（泛化、不绑定具体 App）：codegen UI 自动化规则段
  - 目的地优先桌面 App（已安装就别走网页；前台是浏览器不构成走网页的理由）；
  - 讲明模拟按键对 Electron 也有效；
  - 首选该 App 自己的新建/搜索快捷键（来自已验证知识）；
  - "粘贴前必须验证落点就绪"从"会话已打开"泛化到"新建页面/条目已创建并获焦"。
- 仍需（用户规划的"常用 App 适配"）：把各 App 关键快捷键（Notion Cmd+N 等）沉淀进
  `AgentInteractionKnowledge`；机制上应能从"验证成功的路径"自动生长，而非靠手种。

### codegen 失败的可观测性 + 解析失败重试
- 现象："Dynamic[失败]: AI 返回内容解析失败"，但日志无任何 codegen 原始返回，无从分析。
- 定位：既无 `🤖 生成脚本` 也无 `⚠️ 无法解析（前 1000 字符）`（parseGeneratedScript 的日志）
  → 说明 `parseError` 出在更上游的 **API 响应提取 guard**（拿不到可用 `content` 字符串），
  而该 guard 不打印原始响应。常见于 Gemini thinking 返回空/被 thinking 占满/截断/错误结构。
- 已做：
  - 响应提取失败时打印**原始响应（前 800-1000 字符）+ `finish_reason`**；`finish_reason==length`
    单独告警（maxTokens 截断）；`content` 为空也视为失败并打印。
  - 首轮就解析失败/空 content（无上一版脚本）时也**重新生成一版**重试（原来直接硬失败）。
- 待办：`routeIntentToLearnedSkill` / `promoteSuccessfulScriptToSkill` 的同型 guard 也可补日志（次要）。

### 推理模型把 token 预算烧光导致 content 为空
- 现象：换执行模型为 `minimax/minimax-m3`（重推理、非 Gemini）后，codegen 返回空 content +
  `finish_reason=length`。
- 根因：`applyChatCompletionOptions` 只给 Gemini 配 reasoning，对非 Gemini 无任何 reasoning 限制 →
  推理模型放飞推理，reasoning tokens（算进 completion）把 maxTokens 吃光，content 还没开始就到顶。
  router 的 `maxTokens=512` 对推理模型更是必死。
- 修复（泛化）：
  - **正确的子字段是 `max_tokens`/`enabled`，不是 `effort`**：MiniMax 经 OpenRouter 用统一
    `reasoning` 参数，但 thinking 是 on/off+budget，没有 effort 档（`effort` 不被识别≈没限制）。
    确认来源：OpenRouter MiniMax-M3 API 页。
  - `applyChatCompletionOptions` 增加 `nonGeminiReasoningMaxTokens`，对非 Gemini 设
    `reasoning:{max_tokens:N}`（对 MiniMax 映射为 thinking budget；effort 类模型 OpenRouter 自行
    归一化；不支持的忽略）。codegen 传 2048、router/promote 传 1024 —— 给 content 留足预算，
    又不会在"强制推理"模型上 400。
  - 调大总预算：codegen `maxTokens` 4096→8192；router 512→2048。
  - 结合"空 content 也判失败并重试"，瞬时空返回可自恢复。
- 提示：重推理执行模型需限 reasoning 预算；轻量/非推理模型对 codegen 更跟手更省。

### 意图驱动的「视觉/内容获取」中间层（vision escalation）
- 痛点：原"要不要用视觉"只在最前面、模型看到意图**之前**决策（仅圈选 / 场景 `needsVisualContext`）。
  一旦没截图、而任务需要看屏幕（如读 PDF/图片内容存 Notion），就只能甩给 codegen 去 Cmd+C/OCR
  ——图片/扫描件复制不出文字，必错。
- 原则（用户定）：内容获取应**按意图判断**、用对模态；视觉内容就该 focus 源窗口→截图→多模态读取
  →把内容喂给下游动作。这是**主流程级、可复用**能力（不只 Dynamic Agent），是"前置出内容"的补全。
- 落地（决策：前置模型出指令 + 截源窗口）：
  - 前置模型在"需要看某窗口内容、但本次没附带截图"时输出 `[CAPTURE_CONTEXT]{"reason":...}`
    （加在 builtInDynamicAgentPrompt）。
  - `PromptManager.parseCaptureContextRequest` 解析；`handleProcessingResult` 在路由前拦截，
    调 `runVisionEscalation`：切回录音起始的源 app（`NSRunningApplication.activate`，用户切走也能切回）
    → `ScreenshotManager.captureAmbientContext()` 截当前前台窗口 → 带截图 `processAudio` 重跑一趟
    → 结果按 `escalated=true` 正常路由（不再二次升级）。
  - 默认仍不截图（快/省）；只有意图需要才补一轮。截图需屏幕录制权限（与圈选/ambient 同一套），
    失败给"需屏幕录制权限"提示。
- 细化 D2：窗口/进程**路由定位**走结构化元数据、无需屏幕录制；**读取内容**是视觉、需屏幕录制、意图触发。两者不矛盾。
- 待办：generalize 到 QA/agent 等更多 flow（现指令在 dynamic prompt）；aliyun provider 的 vision 重跑；
  多窗口时更精准地定位"源窗口"（现用源 app 的前台窗口）。

### 成功 case 复盘暴露的问题 + 修复
（一个"看似成功"的 PDF→Notion 跑通后暴露的深层问题）
- **#1 猜 app 标识符**：扫了 108 app 知道真实 bundle id，codegen 却猜 `com.notion.id`（错）→ 编译失败白烧一轮。
  修：prompt 要求启动用 `open -a "<名>"`，绝不猜 bundle id；只有清单给了真实 id 才用 `open -b`/`tell application id`。
- **#2 "假成功"**（内容全粘进了 title）：prompt 的"验证落点"规则没被生成脚本遵守 → 盲粘贴还报成功。
  视觉自动验证太重不做；改用**人在环修复**（用户提议）——见下「人在环自修复」。
- **#3 确认未展示提取内容**：视觉 OCR 的账号/税号直接执行、用户无从核对。
  修：dynamic 确认弹窗的 detail 改为展示 `intent.content` 全文（有 content 时）；`IslandAgentConfirmContent`
  详情区改为可滚动 + 高度上限 190→330，能完整核对长内容。
- **#4 截图过大**：1.2MB/1.67M base64 → 第二趟 10s。修：按最长边压到 1400 + JPEG 0.6。
- **#5 隐私**：财务 PII 随截图上云。修：补抓状态明确为"正在截取窗口画面交给 AI 识别…"（透明，不加确认避免打扰）。
- **#6 promote 会固化隐私**：脚本里 content 硬编。修：promote prompt 强制 name/description 泛化（不带这次数据）、
  正文做成 `{{content}}` 参数。
- 主线：#1/#2/#6 同根——"有 ground truth/该验证"的地方仍依赖模型自觉；本轮把多数挪到确定性/人核对，
  但 #2 的执行层强制验证仍是最大欠账（暂用 #3 人核对兜）。

### 人在环自修复（用户当裁判 + 反馈喂回自修复）
- 思路（用户提议，治 #2）：结果不符预期时，把"放弃"变成"告诉哪儿不对→喂给自修复重做"。
  用户当场的判断本就是最可靠的验证，把它变成**可执行的修复输入**，比视觉自动验证轻得多。
- 落地（**验证/修复与"保存技能"解耦**，放在协调层 `runDynamicIntent`）：
  - 对任何**改动了状态**的动态动作（risk != auto）执行后，常驻弹三选一：
    「✓ 对了」/「✗ 不对，我说哪儿错你重做」/「对了，先别记成技能」。受 `skillDraftConfirmEnabled` 控制。
  - 选"不对"→ `requestTextInput` 收一句反馈 → `repairFromFeedback`：反馈当 `ScriptRepairContext.failureMessage`
    种进自修复，重新 generate→validate→confirm(含 content 核对)→execute → 展示新结果 → **再问（无限轮）**。
  - 选"对了"→ `learnSkillFromSuccess` 才把（已确认的）脚本沉淀为 skill，并提示「以后说『…』就行」。
- 两个关键修正（针对反馈）：
  - **无限轮**（原 maxRepairRounds=2 去掉）。
  - **常驻不消失**：原来验证绑在"保存新技能"(`isBrandNew`)里，不可复用/已存在/第二次跑就不弹 → scheduleHide
    把 UI 收走 = "等待验证时 UI 消失"。现在验证独立于保存，对每次 stateful 执行都弹、且 scheduleHide 在
    验证循环之后才触发。
  - 模型：**验证发生在 dynamic（novel）路径；学成 skill 后复用走 runSkill 不再打扰**——边学边验、学会即信。
- `autoSaveAsSkill` 简化为纯"保存并返回示例"，不再含确认/修复逻辑。
- 复用件：overlay 的 `requestChoice`/`requestTextInput`/`requestUserConfirmation` + 自修复的 `ScriptRepairContext`。
- 仍可叠加（后续）：执行层对"盲 UI 脚本无验证断言"的自动判定，作为人在环之外的兜底。

### 技能优化器（设置内，解决"特例成功、泛化差"）
- 问题：skill 常常是从一次特例成功沉淀的，模板可能写死了具体值/落点，换参数/场景就不行。
- 方案：设置 → 技能列表，每个脚本类技能（非原生动作）行加「优化」入口（魔法棒图标）：
  - 用户补一句"想怎么优化"（如"对任意联系人都能用别写死""内容进正文不要标题"）。
  - `DynamicAgentController.optimizeSkill(skill, userNotes:)` 调模型按诉求重写 template/description/example：
    保留已验证路径、强制把写死值参数化、script_type 不变、校验 params 都用到 {{占位符}}。
  - 返回**未保存**的新版本供预览（新说明 + 新「以后说…」），用户「保存改进」(同 id 覆盖，
    可靠性计数清零) 或「重新优化」。
  - 用户之后**自己用语音测试**；不理想可再优化（迭代）。
- 实现：`SkillOptimizerView`（设置内联编辑器，普通窗口 TextField 无键盘焦点问题）。

### 「优化」与「修复」统一为一个验证循环
- 共用 helper `AgentExecutionCoordinator.verifyAndIterate(overlay:regenerate:)`：进入时 candidate 已执行并展示，
  弹「做对了吗？✓对了 / ✗不对说哪儿错重做 / 先这样」；"不对"→收反馈→调 `regenerate(feedback)`（路径自定）→
  展示新结果→再问（无限轮）。
- **动态执行**（runDynamicIntent）：`regenerate` = `repairFromFeedback`（重生成脚本）；"对了"→ learnSkillFromSuccess。
- **技能复用**（runSkill）：**未受信任**的技能（`needsReuseVerification` = 非内置 且 successCount<1）复用时
  也走同一循环；"不对"→`repairFromFeedback`修这次→修对了用 `updateSkill(id:fromCorrectedScript:)`
  把修对版本**覆盖回这条技能（保留 id）= 复用即改进**；可靠性按用户最终裁决记（验证成功才算成功）。
- **与设置优化打通**：`optimizeSkill` 会把 successCount 清零 → 技能变"未受信任" → 下次复用自动走验证循环、
  可继续反馈改进。即：边学边验 → 验够一次才信 → 优化后重新验。`isBuiltIn` 永远受信任、不打扰。

### 可靠路径优先：有官方 CLI/API 就别做盲 UI（飞书做样板，机制泛化）
- 背景：飞书建日程一直失败——Electron 应用的多步 UI 自动化每步都在猜（进程名/菜单/快捷键/窗口标题/字段/保存），
  自修复在无地面真值的猜测空间里打地鼠，永不收敛。
- 泛化机制（**不新增基础设施，复用「已验证交互知识」**）：一条知识声明"某 App 的某类能力优先用某 CLI/API
  （script_type=shell），命令模式如下，前置安装/登录，缺了清晰报错引导、不要回退 UI"。codegen 已消费这类知识。
  - codegen prompt 加规则：**有 CLI/API 知识就直接走 shell、不做 UI 自动化**（CLI 有确定退出码、可判定成败）。
  - 飞书首个样板种子 `lark_prefer_official_cli`：`lark-cli calendar +create --summary --start --end`（ISO8601，
    已验证语法），脚本开头 `command -v lark-cli || { echo 安装/登录引导; exit 1; }`。
  - 其它 App 按同一结构新增；将来 research 自动产出同样结构的知识 → 长尾兜底。
- 与已有机制叠加：CLI 命令若 flag 不对会非零退出 → 自修复 / 人在环验证循环细化 → 修对后沉淀回技能（复用即改进）。
- 来源：[larksuite/cli](https://github.com/larksuite/cli)、[Create event API](https://open.larksuite.com/document/server-docs/calendar-v4/calendar-event/create)、[feishu-cli 日历命令](https://feishu-cli.com/feishu-cli-calendar.html)。

### CLI 工具的友好安装引导（ToolSetupAssistant，泛化）
- 问题：让非技术用户看到"`需要先安装 lark-cli`"这种技术报错，完全不知所措。
- 老实说：**全自动安装不现实**——lark-cli 装依赖 npm/Node（用户多半没有）、登录是浏览器 OAuth（必须手动）。
  真正非技术友好的终极形态是应用内 OAuth 连接器（产品化阶段）。当下做"尽量自动 + 优雅降级 + 全程透明"。
- `ToolSetupAssistant`（新，registry 驱动，飞书 lark-cli 首条）：
  - 知识里"工具缺失"改为输出哨兵 `[[SETUP_REQUIRED:lark-cli]]`；`DynamicAgentError.setupRequired(tool)`；
    processIntent/processLearnedSkill 检测到哨兵**不自修复**（重生成救不了缺工具），直接返回 setupRequired。
  - 协调层捕获 → 弹友好引导：「『…』需要一次性设置 → 帮我自动安装 / 看图文教程 / 以后再说」。
  - 「帮我自动安装」：先探测前置（node，缺则开下载页+复制命令）→ `npm install -g`（登录 shell 取 PATH，
    180s，带进度）→ 装不了优雅降级（复制命令、识别 EACCES 提示 sudo、开教程）→ 成功则触发 `lark-cli auth login`
    （开浏览器）并提示"登录后再说一次指令"。
  - 全程状态 toast，绝不卡在技术报错。其它工具按 registry 同结构加。

### CLI 登录态/环境不一致（"终端里行、app 里 token_missing"）
- 现象：lark-cli 已装、终端已登录，但 app 执行 `lark-cli calendar +create` 报 `token_missing`、身份回退 bot。
- 根因：`executeShellCommand` 用 `zsh -c` + GUI 应用的精简环境（Finder 启动）——不加载用户 `.zprofile/.zshrc`，
  PATH 和 CLI 登录态都与用户终端不一致。
- 修：① `executeShellCommand` 改 **`zsh -lc`（登录 shell）**，环境与终端对齐（泛化，惠及所有 CLI）。
  ② **把"未登录"做成一等公民**（区别于"未安装"）：知识里首版脚本就稳健输出 `[[LOGIN_REQUIRED:lark-cli]]`
  （匹配 token_missing/authentication 等）；`DynamicAgentError.loginRequired`；协调层 → `ToolSetupAssistant.handleLogin`
  友好引导登录（`lark-cli auth login --domain calendar`，开浏览器）。登录命令在**与执行同一个 `-lc` 上下文**里跑，
  所以登录写入的授权后续执行能读到。日历命令默认需 user 身份，飞书登录用 `--domain calendar`。

### 失败/重试时常驻状态
- 自修复多轮（生成→校验→执行→失败→再生成）原来没有逐轮状态，用户看一个旧 toast 卡着不知在干嘛。
- `processIntent` / `processLearnedSkill` 每轮显示：「正在生成执行方案…」→「执行中…」→「上一版没成功，正在自修复（第 N 轮）…」。
  （DynamicAgentController 非 @MainActor，所有 `.show` 都包 `await MainActor.run`。）

### 执行前也能「改一下」（人在环修复的执行前镜像）
- 问题：第一次生成的方案若不合预期，确认只有「执行/取消」——硬执行浪费一次、取消又得从头说。
- 修：`processIntent` 的 confirm 从二元改为**三选**：`执行 / 改一下（说哪不对）/ 取消`，「改一下」→
  `requestTextInput` 收一句修正/更明确意图 → `generateScript`（repairContext stage="用户执行前修正"，
  feedback 当修正诉求）重生成 → 再确认（**无限轮**）；改后若降到低风险则直接执行。无 overlay 时回退二元确认。
- overlay 复用：新增 `.agentChoiceDetail`（标题 + 可滚动方案详情 + 选项）+ `requestChoice(title:detail:options:)`
  重载（复用 choiceContinuation）。`IslandAgentChoiceDetailContent`。
- 现在执行前后都能「说哪不对→改」：**执行前**改方案（省一次浪费执行，治 Robin/错目标这类一眼可见的问题）；
  **执行后**改结果（治落点/真成功这类要看结果才知道的问题）。

### Phase 1b ✅ 已完成（2026-07，方案与实施记录见 docs/SKILL_ROUTING_UNIFICATION.md）
- 当年推迟的 marker 字面合并已落地，但方向调整：**不引入新信封 `[ACT]`，统一收敛到现成的
  `[SKILL:id]`**——动态 codegen 已退出主流程（语音创建取消、技能一律设置里显式创建），
  为 dev-only 兜底引入新字面不值一轮准确率风险。
- `builtInAgentPrompt` 退役 → 统一「动作路由」章节（白名单 catalog：内置四件套 + 用户技能，
  停用 = 缺席，无反向禁令）；四件套判据平移至 `NativeActionGuidance`；
  `[AGENT_ACTION]` 仅保留运行时兼容 parser，观察 2 个 release 后删除。
- 触发点：两起 beta 实证事故（停用禁令误伤自建技能 / AI 口述场景路由总表标记泄漏致幻觉
  Notion 动作），根因分析同见上述文档。
