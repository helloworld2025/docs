# Relay — Design Guideline v3 (DRAFT)

> **状态：草案，General 设置页 beta 实装先行验证。** 取代 `RELAY_DESIGN_GUIDELINE_v2_DRAFT.md`
>（v2 的字体/颜色/可读性结论全部沿用，本版在其上修订组件与表面层）。
> 背景：v1/v2 把「终端纪律」写成了**所有组件**的硬性条款（锐角、方形开关、1px 边框结构、
> mono 行标签），忠实执行的结果是内容区粗糙、affordance 差。v3 的核心修订只有一件事：
> **划定品牌纪律的辖区**——品牌住在 chrome，内容层回归平台惯例与可读性。

---

## 0. 相比 v2 改了什么（速览）

| 维度 | v2 草稿 | v3（本草案） |
|---|---|---|
| 总纲 | 品牌条款约束所有组件 | **双辖区制**：chrome 全额品牌纪律；内容层平台惯例+可读性 |
| 结构表达 | 1px 边框即结构（卡套卡） | **表面分层即结构**：白卡浮起 + 圆角 + 一档分离阴影；边线降为可选 |
| 圆角 | 默认小或零，按钮/输入锐角 | 内容层：容器 `12` · 控件 `8` · 开关 `pill`（新 token）；chrome/overlay 沿用锐角 |
| Toggle | 方形轨 38×18 + 方形 knob | **胶囊轨 38×22 + 圆形 knob**（仅内容层） |
| 按钮 | mono 大写 + 锐角 + 描线 | 内容层：**Body 句式 + radius 8 + 填充**；danger 默认降权为文字级 |
| 行标签 | mono 12 | **Body 13**（mono 从内容层正文全面退出） |
| 章节头 | mono 大写 + `//` | 卡内 mono 大写小标，**去 `//` 去图标**（`//` 只留 chrome） |
| Chakra Petch | 标题、accents、数字读数 | **收敛为 Headline-only**：每视图至多一个标题时刻；数字读数改 mono |
| 行图标 | 无 | 内容行新增 **leading 功能图标**（primary 蓝、线性、统一框） |
| 阴影 | 零柔阴影 | 内容层允许**一档分离阴影**（black 4%、r2、y1，仅浅色）；其余仍禁 |
| Overlay | — | **一字不动**（品牌最强资产，v1 §6.3 全文有效） |

颜色（§2）、动效（§5）、语气（§8）、栅格（§9）**沿用 v2 草稿原文**，本文不重复。

---

## 1. 双辖区制（v3 总纲）

taste-gate 沿用并升级。v1 的判据是「引用旧机器的**纪律**，不模拟其**材质**」——v3 指出：
**方形开关、锐角按钮、边框套边框，正是组件级的材质 cosplay**。它们牺牲 affordance
（开关读不出开/关、按钮读不出可按）去换复古感，按 taste-gate 本应 reject。

由此把界面划成两个辖区：

### Chrome 辖区 —— 品牌纪律全额执行
标题条、侧栏导航、章节小标、状态语言（tag/badge/keycap/LED）、overlay、菜单栏标记。

- mono 大写 + tracking；`//` 标记；锐角；1px hairline；hardware-indicator 配色；硬切动效。
- 这是用户「认出 Relay」的地方，密度低、字符短，terminal 语言在这里只加辨识度不减可读性。

### 内容辖区 —— 平台惯例 + 可读性优先
设置行、控件（开关/下拉/按钮/输入框）、正文、表单、列表、说明文字。

- 控件长得像用户见过一万次的控件（胶囊开关、圆角下拉），affordance 零学习成本。
- 品牌以三种方式在场：**色相**（Relay Blue 做功能强调）、**图标**（线性、统一节奏）、
  **排印**（三族字体的纪律性分工）——而不是以锐角和边框在场。

> 判据一句话：**用户盯着读、伸手操作的东西 = 内容辖区；框住内容、标注状态的东西 = chrome。**

---

## 2. 颜色

沿用 v2 草稿 §2 全文（Layer 1 身份填充 / Layer 2 功能描线、中性浅底 Cloud/Haze、
overlay 恒暗、State→Color 表）。v3 仅补充一条使用纪律：

- **Danger 降权**：`alertFill` 实底红只允许出现在**确认弹窗的确认钮**上。行内销毁 =
  红色图标按钮（tone 描线级）；页面级销毁入口 = danger-text 按钮（红字 + `alert` 8% tint 填充）。
  破坏性操作的视觉权重永远低于页面主操作——红色是确认时刻的语言，不是常驻装饰。

---

## 3. 字体（v3 重划职责）

三族与中文兜底沿用 v2（Chakra Petch+GlowSans / Barlow+Sarasa Gothic / IBM Plex Mono+Sarasa Mono），
**职责边界收紧**，对应品牌 specimen 的 HEADLINE / BODY / SUPPORTIVE 三层：

| 族 | 角色 | 允许出现的地方 | 明确禁止 |
|---|---|---|---|
| **Chakra Petch**（HEADLINE） | 标题时刻 | 页面标题（每视图**至多一次**，≥18pt）、onboarding hero、营销物料 | 行内文字、控件、章节头、数字读数、任何 <18pt 场景 |
| **Barlow**（BODY） | 内容层一切 | 行标签、说明/caption、按钮文字、输入框、下拉、正文/回答 | chrome 标签、tag |
| **IBM Plex Mono**（SUPPORTIVE） | chrome 与数据 | 侧栏导航、章节小标、tag+`//`、keycap/快捷键、版本号/ID、数字读数、状态行 | 成句正文（v2 §3.2 可读性规则继续有效） |

排印规格（内容层变更项）：

| 角色 | v2 | v3 |
|---|---|---|
| 行标签 | Mono 12 | **Body 13 regular**，`textPrimary` |
| 说明 / caption | Body 11 | 不变（Body 11，`textSecondary`） |
| 按钮 | Mono 11 semibold UPPERCASE | **Body 12 medium 句式**（chrome 内按钮仍 mono caps） |
| 章节头 | Mono 10 UPPERCASE + `//` | Mono 10 semibold UPPERCASE，**无 `//`**，`textTertiary` |
| 数字读数 | Display 14 + mono digits | **Mono 12–14**（数据归 supportive，Chakra 退出） |
| 页面标题 | Display 18 semibold | **Display 20–24 medium，句式大小写**（不强制 UPPERCASE） |

> Chakra 的克制是 v3 字体修订的重点：它个性强，出现两次就开始抢戏。
> 「一个视图一个 headline 时刻」，其余场合一律 Body/Mono。

---

## 4. 表面、深度、圆角（v3 重写）

### 4.1 表面分层即结构

三级面沿用 token，但结构表达从「边框」换成「明度差」：

```
surfaceDeep   画布（浅: Cloud #EEF0F3 / 暗: Carbon）
surfaceRaised 卡片（浅: White / 暗: Graphite）——内容坐在卡上
surface       凹槽（浅: Haze / 暗: Onyx）——输入框底、下拉底、开关轨(off)、次级按钮底
```

- **内容层卡片**：`surfaceRaised` + radius `l(12)` continuous + 描线 `surfaceLine` 50%（可省）
  + 分离阴影（见下）。卡内不再嵌套带边框的容器——**边框套边框是废除项**。
- **分离阴影（新增，一档）**：`black 4% · radius 2 · y 1`，仅浅色模式的内容层卡片；
  暗色模式靠明度差，无阴影。这是功能性对比（卡与画布的分离），不是装饰投影——
  超出这一档的阴影仍然全部禁止。
- **chrome/overlay**：锐角 + hairline 照旧（overlay 的 tight separation shadow 规则不变）。

### 4.2 圆角标尺（更新）

`none 0 · xs 2 · s 4 · m 8 · l 12 · overlay 14 · pill(新)`

- 内容层：容器 `l` · 控件（按钮/输入/下拉）`m` · 开关轨/knob `pill`。
- `pill` 是 token（BrandTheme 内取半高），**仅限开关**；`Capsule()` 字面量与标尺外数值仍被
  brand-lint H5 拦截。
- chrome/overlay：`0–2` 与 `overlay 14` 照旧。

间距标尺沿用（4·8·12·16·24·32）；行内边距沿用 水平14/垂直10，
行高因 Body 13 + icon 自然增高，不额外加垂直 padding。

---

## 5. 动效

沿用 v2/v1 全文（`Animation.brand*` 单一来源）。胶囊开关的 knob 位移用 `snap`。

---

## 6. 组件（内容层 v3 规格）

### 6.1 Section 卡
- 章节头**移入卡内**顶部：mono 10 semibold UPPERCASE，tracking 0.8，`textTertiary`，
  无 `//`、无图标（图标职责下移到行）。
- 行间 divider：`surfaceLine` 60%，**左右 inset 14**（不再通到卡边）。
- caption/hint/链接行不被 divider 圈住（沿用自动 divider 的 opt-in 机制）。

### 6.2 行（Row）解剖
```
[icon 17pt] [标题 Body 13 + caption Body 11] ······ [trailing 控件]
```
- **leading 图标（新）**：SF Symbol、`primary` 色、regular weight、15pt 字号、固定 20pt 框——
  给列表建立扫读节奏。状态性行可换语义色（如已完成 = `success`）。
- 静态值（"已开启"、"自动开启"）用 Body 12 `textSecondary`，不再用 mono。

### 6.3 控件
- **Toggle**：胶囊轨 38×22；on = `primaryFill`、off = `surface` + `surfaceLine` 描线；
  knob 白色圆形 18 + 极轻描影（两模式一致）。动效 `snap`。
- **下拉（MenuPicker）**：闭合态 = `surface` 填充、radius `m`、Body 12、chevron.down；
  展开描线转 `primary`。列表 = radius `m`、Body 12 行、选中 `primary` + ✓。
- **按钮**：radius `m`、Body 12 medium 句式。
  `primary` = `primaryFill` 白字 · `secondary` = `surface` 填充 `textPrimary`（无描线）·
  `danger` = `alert` 红字 + 8% tint（实底红只在确认弹窗）。按压 = 1px 下沉（保留，机械手感）。
- **输入框**：`surface` 填充、radius `m`、Body 12；聚焦描线 `primary`。
- **Keycap（新组件）**：快捷键展示专用——mono 11、`surface` 填充、`surfaceLine` 描线、
  radius `s`、微下边框加厚（键帽暗示）。
- **内嵌说明面板（新模式）**：开关行下的附属长内容（如语音技能清单）不平铺成行——
  收进 `surface` 凹槽（radius `m`、padding 12、左缩进 34 对齐上方行的文字列），
  条目 = 图标(`agent`/`primary`) + 名称 Body 12 medium + 一句描述 + **示例语句 chip**
  （quote 图标 + bodyItalic 11 + `surfaceRaised` 填充 radius `s`）。
  面板整体读作上方开关的从属说明，而不是并列的设置行。
- **Badge / Chip / Tag / HintRow**：属 chrome，保持锐角 + mono（品牌在内容区的签名点缀）；
  HintRow 的**正文**部分改 Body 11（成句可读性规则）。

### 6.4 Chrome 组件
- **标题条（v3 更新）**：蓝底，高 48；窗控红绿灯与 `TITLE // SETTINGS` mono caps
  同行垂直居中；旧版自绘 ✗ 关闭钮与前导 `//` 退役。
  红绿灯为**自绘**（`BrandTrafficLights`，取系统标准窗控色 token，hover 显符号，
  行为等效 close/min/zoom）——原生三钮在自绘 titlebar 上不可靠（解除隐藏会引入
  titlebar 安全区与 z-order 连锁问题，实测三轮），在设置窗恒隐藏。
  窗控语义仍是系统的（颜色/符号/行为一比一），不算材质 cosplay。
- **侧栏（v3 更新）**：导航项 = leading 图标（13pt，选中 `primary`/未选中 tertiary）+
  mono caps 标签（保留——侧栏属 chrome）；选中态 = 圆角 `m` pill（`primary` 12% tint），
  3px 左条退役；pill 与侧栏边缘留 8pt 缝。
- **不变项（防误改）**：侧栏 footer（LED + 版本 mono）、BrandTerminalTag、
  overlay 全套（v1 §6.3 逐字有效：无扫描线、无计时器、block progress、peak-hold 波形）。
- **Overlay 的 v3 修正（2026-07，仅原则执行，骨架不动）**：
  ① 恒暗 token 家族补齐——`overlayWarning/overlayAgent/overlayListening` 硬编码亮值，
  overlay 上**禁止**使用 scheme-aware 功能色（浅色系统解析成深值压碳黑不可读）；
  ② 面板内**成段正文**（confirm/choiceDetail 的 detail、答案、转写）遵循 §3.2 走 Body，
  层级用语义色不用 opacity 压暗；tag/按钮/状态短语保持 mono——面板骨架不变；
  ③ 待命灯（LISTEN）= 绿；一闪而过的成功态（OK/copied/latency）保持蓝，避免短时多色跳变；
  ④ `overlayDim` 提亮至 #7A7A7A（对照 v2 tertiary 提升逻辑）；
  ⑤ 长错误可点击展开为 `errorDetail` log panel（ERR 红条 + 全文 + COPY），
  单行截断不再是死胡同；⑥ 数字读数（latency）归 mono，Chakra 全线退出非 headline 场景。

---

## 7.–9. 表达性系统 / 语气 / 栅格

沿用 v2 草稿原文。

---

## 10. 落地与迁移

- **试点范围（已扩展）**：整个设置窗（全部 tab + 侧栏 + 标题条）、**历史独立窗口**、
  **onboarding / 登录 / 白名单门控**（后三者为直接重构，无 v1 分支保留）。
  开关 `AppSettings.settingsUIV3Enabled`（默认开；dev 在 General 页尾有 A/B 开关）。
  原语按 `\.brandV3` environment 分叉；注入点：SettingsView（shell 级）、
  openHistory / presentOnboarding / AuthWindowController（窗口级）。
- **窗口 chrome 一览**：设置/历史窗 = 蓝条 48 + 自绘红绿灯（原生钮恒隐藏）；
  onboarding/门控窗 = 蓝条 48 + **原生关闭钮**（左让位 76，关闭有真实语义：退出/放弃进度），
  无最小化/缩放。onboarding 蓝条内嵌进度轨（白/白 28%）。
- **onboarding 内容层语法**：模拟 app 窗口 = 圆角 `m` 卡 + 分离阴影 + hairline（active =
  `primaryInk` 1.5 描线示意"当前的窗"）；其内输入框 = 圆角 `s` 凹槽无描边；台词气泡 =
  圆角 `m` raised 卡、静默无边框、录音时亮 `capture` 描线（状态即边框）；键帽同 BrandKeycap
  规格；提示/状态成句一律 Body（键帽字符、章节 tag 仍 mono）。
- 后续推广：弹窗/菜单。**overlay 永不迁移**。
- brand-lint：H5 标尺新增 `Radius.pill` token（字面量 Capsule 仍禁）；其余硬性项不变。
- 推广完成后 v3 合入正式 `RELAY_DESIGN_GUIDELINE.md`，v1/v2 归档。

## 11. Do / Don't（v3）

**Do（chrome）**：mono caps + `//` · 锐角 · hairline · hardware-indicator 色 · 硬切动效。
**Do（内容层）**：表面分层 · 容器 12 / 控件 8 / 开关 pill · Body 字体 · 行图标节奏 ·
danger 降权 · 一档分离阴影。

**Don't**：Chakra 出现第二次 · mono 排成句 · 边框套边框 · 方形开关 · 内容层锐角按钮 ·
`alertFill` 出现在确认弹窗之外 · 阴影超出一档 · 渐变进功能 chrome · `//` 出现在 chrome 之外 ·
中文标题行高 <100%。
