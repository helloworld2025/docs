# Relay — Design Guideline v2 (DRAFT)

> **状态：已被 v3 取代（superseded）。** 组件与表面层条款以
> `RELAY_DESIGN_GUIDELINE_v3_DRAFT.md` 为准；本文的颜色（§2）、动效（§5）、
> 语气（§8）、栅格（§9）等章节被 v3 引用沿用，作为其附件继续有效。
> 本文件不覆盖现有 `RELAY_DESIGN_GUIDELINE.md`，也未改动任何代码。
> 目的：把 2026-06 新版 *Relay Brand Guideline V1.0* 校准进产品 UI 规范。
> 校准原则：**品牌层（颜色 / 字体 / 表达性元素）按品牌手册更新；产品层（功能性纪律、
> instrumentation、no-scanline、防焦虑等）沿用 v1 不丢。** 这是校准，不是重做。

---

## 0. 相比 v1 改了什么（速览）

| 维度 | v1 | v2（本草案） |
|---|---|---|
| 主蓝 | Electric Blue `#1F3FFF` | **Relay Blue `#082DB1`** + 深底提亮版 `primaryScreen #3A62EE` |
| 强调色 | 红/绿/紫/琥珀 四套 | **橙 + 黄** 两套；红降级为功能告警；绿/紫移除 |
| capture/录音 | Alert Red | **Accent Orange `#F57A4D`** |
| warning | Signal Amber `#F2B843` | **Accent Yellow `#F4FD54`** |
| agent/skills | Signal Violet `#6E7BFF` | **Accent Yellow**（与 warning 共色，按组件/标签区分） |
| listening / success | Terminal Green | **Relay Blue / tint**（弃绿） |
| 浅色面基调 | Chalk `#F2F2F2` | **Ivory `#E5EAE6`** |
| 字体 | Chakra Petch + Sarasa Mono SC（正文也用等宽） | **Chakra Petch + Barlow + IBM Plex Mono** 三族；mono 仅做 chrome |
| 中文字体 | Sarasa Mono SC（全角色） | **GlowSans SC（标题）+ Sarasa Gothic SC（正文）+ Sarasa Mono SC（标签）** |
| 渐变 | 一刀切禁止 | **分级**：营销/hero/空状态可用；功能 chrome 仍纯平 |
| 文档新增 | — | §7 表达性系统、§8 语气与微文案、§9 版式栅格 |

---

## 1. 品牌概念

Relay 通过**经典通信系统**与**早期计算文化**的透镜，重新诠释 AI 语音输入工具。

品牌手册的四个概念锚点，并入产品语言：

- **Computational** — 结构化、有意图、像被精密工程过。
- **Nostalgic-modern** — 用怀旧制造温度/熟悉/记忆点，但骨子里现代。
- **Transition** — 让人感到「正在被捕捉 → 处理 → 完成」。
- **Controlled** — 为掌控感与确定性而设计。

三根设计支柱（沿用）：**Terminal · Experimental · Retro-Tech**。

**taste-gate（品味闸门，沿用并扩展）。** 怀旧活在*骨架*，未来活在*行为*。我们引用旧机器的
**纪律**（栅格、等宽、`//` 注释、编号层级、hardware-indicator 配色、量化块状指示器），绝不
**模拟其材质**（扫描线、荧光衰减、斜角、颗粒、做旧）。**v2 补充：** 渐变与「数字图层」
（§7）进入*表达性系统*，可用于品牌/营销/hero/空状态；但**功能性 chrome（overlay、设置、
状态行）仍受 taste-gate 约束——real data is ornament, fake texture is noise。**

语音/营销 tagline：**“Speak. Capture. Send.” / “Voice becomes action.”**
（产品内仍可并用 “Speak it into being.”；见 §8。）

---

## 2. 颜色

> **第一性原理：UI 配色以可读性优先，品牌是身份层，不是 UI 的字面取值。**
> 品牌色板给「色相方向 + 身份时刻」；功能性 UI 色按真实浅/深底的对比度选值，驱动 ~95% 的界面。
> 品牌色读得清的地方直接用，读不清的地方换功能性变体——**这不算违反品牌**。

颜色分两层：**Layer 1 身份填充**（saturated，只在身份时刻）、**Layer 2 功能描线/文字**
（scheme-aware，两底都达 AA）。权威取值见 `BrandTheme.swift`，本节是其镜像。

### 2.1 色板（raw）

| Token | Hex | 用途 |
|---|---|---|
| Relay Blue | `#082DB1` | 主信号；**填充/标题条/营销/白字底** |
| Brand Yellow | `#F4FD54` | 身份点缀 / 黄色块（深色文字 18:1）；功能 warning/agent 见 §2.2 |
| Relay Blue Dim | `#061F7D` | 按压/idle 填充（= Relay Blue 75% over black）|
| Relay Blue Ghost | `#0B1A52` | 深 tint 背景（Relay Blue 低透 over black）|
| Brand Orange | `#F57A4D` | capture 填充 / overlay 录音（深色图标 7.3:1）|
| Alert Red | `#E60023` | danger 按钮**填充**（白字 4.8:1）；功能 alert 文字见 §2.2 |
| Carbon | `#0A0A0A` | 最深面（overlay、暗底基）|
| Onyx | `#141414` | 暗面（= 品牌 Carbon Grey）|
| Graphite | `#1E1E1E` | 暗 raised 面 |
| Slate | `#2A2A2A` | 暗态分隔线 |
| Ash / Smoke | `#5E5E5E` / `#9C9C9C` | 三级/二级文字（暗）|
| Cloud / Haze | `#EEF0F3` / `#E4E7EC` | **浅色画布 / 侧栏·凹槽**（中性偏冷，无绿调）|
| ~~Ivory~~ | ~~`#E5EAE6`~~ | 已退役：偏绿，大面积发脏；UI 底色改用上面的中性灰 |
| Mist / Fog | `#E3E3E3` / `#C8C8C8` | 浅 raised 面 / 浅态分隔线 |
| Paper | `#FFFFFF` | 最浅面 |

> 上表是 **Layer 1 身份填充**（`primaryFill` / `alertFill` / `captureFill` / `brandYellow`）+ 中性面。
> **填充 vs 描线铁律：** saturated 品牌色只做**填充**（按钮、标题条、LED），内容压在上面靠填充自身对比
> （白字/`#082DB1` 10:1、深字/`#F4FD54` 18:1）。**绝不**把品牌填充色当成深底/浅底上的描线或文字——
> 那是 Layer 2 的事（见 §2.2）。`#082DB1` 压黑只有 1.9:1、`#F4FD54` 压白只有 1.1:1，都会糊。

### 2.2 Layer 2 · 功能性描线/文字色（scheme-aware）

UI 的默认色。每个 = (深底用亮值, 浅底用深值)，**全部实测 ≥4.5:1（文字 AA）**。这层不照搬品牌
swatch——取品牌色相，值按对比度定。绿/紫作为功能色回归（状态区分 > 色板纯洁度）。

| 语义 | Dark（onyx/graphite） | Light（ivory/white） | 用途 |
|---|---|---|---|
| `primary` 蓝 | `#5384FF` (5.4/4.9) | `#082DB1` (8.5/10.4) | 主信号、链接、选中、section 头 |
| `success` 绿 | `#3DDC97` (10/9.4) | `#0A6B40` (5.4/6.6) | 完成/就绪/已授权（`listening` 同此）|
| `warning` 琥珀 | `#F2B843` (10/9.3) | `#7E6300` (4.7/5.7) | 注意 / hint |
| `alert` 红 | `#FF5468` (5.9/5.3) | `#C70019` (5.0/6.1) | 错误/销毁的文字与图标 |
| `capture` 橙 | `#F57A4D` (6.8/6.2) | `#B0481F` (4.6/5.5) | 捕捉/录音（非 overlay 场景）|
| `agent` 紫 | `#9AA6FF` (8.1/7.4) | `#4A4FCF` (5.2/6.3) | agent / skills |

**面与文字（scheme-aware）：** `surfaceDeep` 0A0A0A/**EEF0F3** · `surface` 141414/**E4E7EC** ·
`surfaceRaised` 1E1E1E/**FFFFFF（白卡浮起）** · `surfaceLine` 2A2A2A/**D5D9DF** ·
（浅色底从旧 ivory `#E5EAE6` 偏绿改为中性偏冷灰：大面积底色保持中性，品牌色只在 accent。）
`textPrimary/Secondary/Tertiary` F5F5F5·9C9C9C·**8A8A8A**（暗）/ 0A0A0A·4A4A4A·**6E6E6E**（浅）。
（tertiary 从旧 5E5E5E/9C9C9C 提到 8A8A8A/6E6E6E：旧值贴 AA 地板且常被误用于成句正文，提升后即便误用也仍可读。见 §3.2 可读性规则。）

**Overlay 永远暗**（OLED 风，不随系统，用硬编码亮值避免浅色模式解析错）：
`overlayFill #0A0A0A` · `overlayInk #F5F5F5` · `overlayAccent #5384FF`（蓝）·
`overlayCapture #F57A4D`（橙）· `overlayAlert #FF5468`（红）· `overlayRule white@8%`。

### 2.3 State → Color

| 状态 | 颜色（Layer 2 功能色）|
|---|---|
| recording / capture | `capture` 橙（overlay 用 `overlayCapture`）|
| processing / web search | `primary` 蓝 |
| listening（常驻 idle）| `success` 绿（低亮 `pulse`）|
| success / copied / OK | `success` 绿 |
| error | `alert` 红 |
| warning / hint | `warning` 琥珀 |
| agent / skills | `agent` 紫 |

> warning（琥珀）与 agent（紫）现在是**两种独立功能色**，不再需要消歧；绿、紫回归带来天然的状态区分。
> 身份强调（按钮、标题条、LED）走 Layer 1 填充。

---

## 3. 字体

三个西文族 + 各自的中文兜底（全 OFL，可随 app 内嵌）。

| 角色 | 西文 | 中文兜底 → 末端 | 字栈（CSS/概念） |
|---|---|---|---|
| **Display** 标题 | Chakra Petch *Medium* | **GlowSans SC** *Medium* → Noto Sans SC | `'Chakra Petch','GlowSans SC','Noto Sans SC',system-ui,sans-serif` |
| **Body** 正文/回答 | **Barlow** *Light* | **Sarasa Gothic SC** → Noto Sans SC | `'Barlow','Sarasa Gothic SC','Noto Sans SC',system-ui,sans-serif` |
| **Mono** 标签/系统 | **IBM Plex Mono** | **Sarasa Mono SC** | `'IBM Plex Mono','Sarasa Mono SC',ui-monospace,monospace` |

> Body 从 v1 的「等宽 Sarasa」改为 **Barlow（非等宽）**；**Mono 仅保留给标签/规格/状态/技术细节**。
> 三款中文都同源或近源（GlowSans、Sarasa 均基于思源黑体），中文「声音」统一。
> 字体加载器须从**文件元数据**读 family name，勿按文件名猜（Sarasa 为 Nerd-patched 构建）。

### 3.1 排印规格

| 角色 | 字号 (pt/sp) | 字重 | 行高 | 字距 | 大小写 |
|---|---|---|---|---|---|
| 标题 Display | 18–28 | Medium | **Latin 90% / CJK ~100%** | 0 | Latin **UPPERCASE** |
| 章节头 | 10 | semibold | — | +0.8 | UPPERCASE + `//` |
| 正文 / 回答 | 12–13 | Light/Regular | **Latin 110% / CJK ~150%** | −2% | 句式 |
| 行标签 | 12 | regular | 140% | −2% | — |
| 说明 / hint | **11**（Body，非等宽）| regular | 140% | — | — |
| 终端 tag | 9 | semibold | — | +0.6 | UPPERCASE + `//` |
| 数字读数 | 14 | semibold（等宽数字） | — | 0 | — |

> **两个 CJK 排印坑：**（1）标题行高 90% 是 Latin 专用，**中文标题别低于 ~100%，否则切字**；
> （2）正文 Barlow 110% 也是 Latin 的，**中文正文走 ~150%**。

### 3.2 可读性规则（Readability rules）

「可读性优先」落到字体/字号/颜色的硬性约束。设置界面成句说明曾普遍用「等宽 10pt + tertiary」，
暗色下贴 AA 地板又难读——以下为纠偏后的规范：

- **成句描述 / caption / hint：** 一律 **Body 字体（Barlow / Sarasa Gothic）、≥11pt、`textSecondary`**。
  **禁止**用等宽排成句正文，**禁止** <11pt 的正文。
- **Mono 只用于：** 章节头、`//`、标签 / 徽章、按钮、键值 / 数据 / 时间戳 / 字数读数。短词可，长句不可。
- **颜色三层语义：** `textPrimary`=正文主体；`textSecondary`=描述 / 说明 / 状态文案；
  `textTertiary`=**仅限微标签**（证据数、字数、来源、版本号）。别把成句说明放进 tertiary。
- **禁止用 `.opacity()` 压暗文字来表达层级**——层级用语义色（primary/secondary/tertiary），不用透明度衰减。
  透明度只用于非文字（描边、hover 背景）。
- **对比度目标：** 任意文字 ≥4.5:1（AA），正文 / 说明争取 ~6:1。暗色 tertiary 已为此从 5E5E5E 提到 8A8A8A。

### 3.3 编号与终端标记

设置侧栏与页头**不再使用 `01/02/03` 数字序号**（无信息量、徒增噪声）。
**保留** `// ` 终端标记与章节头 UPPERCASE——它们是品牌骨架（taste-gate 的「纪律」一侧），不是序号。

---

## 4. 间距 / 圆角 / 描边（沿用 v1）

**锐角、清脆 hairline、零柔阴影。**

- 间距：`4 · 8 · 12 · 16 · 24 · 32`（单位 4）。
- 圆角：`none 0 · xs 2 · s 4 · m 8 · l 12 · overlay 14`。默认小或零；按钮/输入/tag = 锐角(0–2)；容器 ≤12。
- 描边：hairline `1` · regular `1.5` · heavy `2`。边框是 1px 实线，不是阴影。
- 行内边距：水平 14 / 垂直 10（单一来源）。

---

## 5. 动效（沿用 v1）

硬件开关手感，不橡皮筋。源：`BrandTheme.swift` `Animation.brand*`。
`snap .30/.85 · resize .26/.86 · collapse .18/.94 · appear easeOut .18 · disappear easeIn .10 ·
reveal easeOut .24 · pulse 1.0 · blink .55 · scan 1.6（保留） · pop .28/.62`。
硬切优先于模糊；透明度+小位移优先于缩放；循环慢而克制，one-shot 快。视图内禁止内联时长/弹簧。

---

## 6. 组件（沿用 v1，仅颜色随 §2 流转）

- **终端文案约定**：状态/标签用前导大写 **tag + `//`**：`REC // · AI // · NET // · OK // ·
  ERR // · LISTEN //`；章节头/页脚也以 `//` 收尾；侧栏编号 `01 GENERAL //`。tag 必须首次可读，
  不用黑话。
- **设置原语**（macOS 参考 `BrandSettingsPrimitives.swift`）：Shell（蓝标题条 + 编号侧栏 + 内容）·
  Section（mono 大写 `TITLE //` + 1px 锐角容器）· Row（标签 lead / 控件 trail）· 自动分隔线
  （仅主控件行）· Toggle（方形轨 38×18，开=蓝填充）· Button（锐角、mono 大写；primary=蓝填充、
  secondary=描边、danger=红填充；按压 1px 下沉）· Picker（自绘下拉）· Status badge（锐角 12% tint
  chip）· Hint row（色条 + `TAG //`）。
  - **颜色更新点**：填充走 Layer 1（`primaryFill #082DB1` 白字 / `alertFill` / `captureFill`）；
    文字·描线·LED·选中走 Layer 2 功能色（`primary` 深底 `#5384FF` / 浅底 `#082DB1`）；overlay 用 `overlayAccent #5384FF`。
- **Overlay / 浮窗状态**（`OverlayWindowController.swift`）：Carbon `#0A0A0A`、14pt 底角、1px
  hairline rim（静态）· present 时一次性蓝色 reveal sweep（用 `primaryInk`）· **无扫描线**（已废，勿加）·
  状态行单一规格：方形 LED 6×6 · tag mono 9 · 表（波形 56×22 / 块进度 64×8）· 状态文 mono 11 ·
  录音 LED `blink`、被动 `pulse` · 波形方头条 + peak-hold tick · 处理 `[████░░░░]` 块进度、
  **无计时器**（防焦虑）。
- **图标**：App 图标 = carbon squircle + 蓝色字形；菜单栏标记 = 圆角方框 + 双 chevron `»`。

---

## 7. 表达性系统（v2 新增）

供**品牌 / 营销 / 编辑 / hero / 空状态**使用；**不进功能性 chrome**。

- **渐变（解禁，分级）**：可用品牌四种——暗蓝（terminal 氛围）、蓝→橙（capture→processing 过渡，
  呼应 “Transition”）、黄→象牙、象牙→蓝。**克制**：加深度/层级/氛围，不抢信息。功能 chrome 仍纯平。
- **数字图层（digital layer）**：品牌蓝色块填满 text/data/signal 碎片，可矩形/几何/有机剪影，做
  「system reveal」。建议用于 onboarding、处理背景、空状态、web hero。Overlay 的 reveal sweep 是其小弟。
- **线条/波形 line art**：声波/信号轨迹/transition 的核心装置；overlay 波形已在用，可外扩营销与空状态。
- **`//` 双斜杠**：品牌的签名式图形点缀（可用 Accent Orange）。与产品 tag 语法同源，正式收编。

---

## 8. 语气与微文案（v2 新增）

三种语气（来自品牌手册），用于一切面向人的字串（按钮、onboarding、空状态、营销）：

- **Precise** — 直接、有用、可执行。短句、主动。避免空泛 AI 承诺与无证据大词。
- **Flowing** — 描述「思考→语音→文字→行动」的连续运动；强调减少打断，不堆功能。
- **Tactile** — 让智能可感：press / capture / release / send / signal；不像 chatbot，不滥用 buzzword。

**Do / Don't（节选）**：用短主动句 · 让收益立刻清楚 · 用物理动词 ·保持冷静精确自信 ／
别像生成内容 · 别无证据夸大 · 别让产品显得神秘魔法 · 别打断节奏过度解释。

**Tagline**：营销 “Speak. Capture. Send.” / “Voice becomes action.”；产品内可用 “Speak it into being.”。
终端 tag（`REC //` 等）属系统语，不受语气章节约束。

---

## 9. 版式栅格（v2 新增，主要给 web / 营销）

- **边距**：取应用短边 ÷ 20；最外两列即边距，内 18 列为内容列。极端宽/高时手动微调。
- **栅格**：边距确定后，内容区 ÷3 为基础栅格；需要更细则继续 ÷6、÷12。
- 内容相对边距、画幅、行长排布。紧凑的原生 overlay 不强求列栅格，沿用 §4 间距即可。

---

## 10. 平台与资源

- **新增 OFL 字体文件**（待 drop 进 `mac/Resources/Fonts/` 等）：
  - `Barlow-Light/Regular/Medium.ttf`（body 西文）
  - `IBMPlexMono-Regular/Medium/SemiBold.ttf`（mono 西文）
  - `GlowSansSC-Normal-Medium.otf`（标题中文，字重 Medium；可子集化控体积）
  - `SarasaGothicSC-*.ttf`（正文中文；待拉，OFL，与已有 Sarasa Mono SC 同项目）
  - 已有：`ChakraPetch-*`、`SarasaMonoSC-*`。
  - 末端兜底 `Noto Sans SC`（= 思源），各端按需。
- macOS / Android / Web 各端 token 与字栈按 §2 / §3 更新；命名向品牌词靠（Relay Blue / Carbon / Ivory）。
- `brand-lint.sh` 的硬约束（无内联动效、无系统语义色、无裸 hex、无系统字体样式、圆角在标度内）
  随新 token 更新白名单。

---

## 11. Do / Don't（更新）

**Do：** 锐角 · 1px 实线边 · mono + `//` tag · hardware-indicator 配色（蓝/橙/黄）· 硬切动效 ·
编号/标注层级 · 渐变仅用于品牌/营销/hero。

**Don't：** 圆角胶囊 · 阴影当边框 · 渐变进功能 chrome · 弹跳 iOS 弹簧 · 粉彩/装饰色 · 居中漂浮布局 ·
中文标题行高低于 ~100% · 正文用等宽。

---

## 12. 待办 / 迁移清单

- [ ] §2.3 黄色消歧最终落到组件级（warning 左色条 vs agent 描线）。
- [x] `primaryScreen` 定为 **#3A62EE**（实测 Carbon 3.9 / Onyx 3.7 / Graphite 3.3，全过 3:1 UI 阈值；不用于深底正文小字）。
- [ ] `Relay Blue Ghost` 具体值确定（当前 `#0B1A52` 为估算）。
- [x] body specimen 通过：Barlow Light + Sarasa Gothic SC 中英混排可读，比等宽 Sarasa 明显更顺。
- [x] 标题中文字重定为 **Medium**（Heavy 过重；配 Chakra Petch SemiBold，cascade 按 .semibold 就近匹配）。
- [ ] GlowSans 标题中文字符覆盖核查 + 子集化方案。
- [ ] 三端 token 改名 + 字栈落地（待批准后才动代码）。
- [ ] 同步更新正式 `RELAY_DESIGN_GUIDELINE.md`（本草案批准后）。
