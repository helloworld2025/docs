# Relay — Design Guideline

> Single source of truth for the Relay brand UI across macOS and Android.
> The macOS app (`mac/`) is the **reference implementation**; Android
> mirrors these tokens and patterns within platform conventions.

---

## 1. Brand concept

Relay reimagines an AI voice-input tool through the lens of **classic
communication systems** and **early computing culture**. The feeling is:

- **Post-desktop / terminal aesthetic** — command-line information hierarchy,
  monospace type, `//` annotations, block indicators, hardware-indicator
  color logic.
- **Iconic, clever, memorable** — zero decoration, absolute utility.
- **Old-tech nostalgia, future-facing** — retro GUI blocks, sharp corners,
  electric signal accents.

Three design pillars:

| Pillar | Meaning |
|---|---|
| **Terminal** | Visual language rooted in early computing — mono type, prompts, scanlines. |
| **Experimental** | Expressive, dense, technical layouts. |
| **Retro-Tech** | Warmth of past tech eras, reinterpreted. |

**The tension rule（taste gate）.** Retro lives in the *skeleton*; future
lives in the *behavior*. We quote the **discipline** of old machines — grid,
mono type, `//` annotations, numbered hierarchy, hardware-indicator color,
quantized block indicators — and never **simulate their materials**
(scanlines, phosphor decay, bevels, grain, faux aging). The stricter the
static language and the more impossible the dynamic behavior (fluid morphing,
live AI telemetry, real-time metering), the stronger the contradiction.
Every proposal must answer one question: *engineering discipline (keep) or
material cosplay (reject)?* Real data is ornament; fake texture is noise.

Voice/marketing tagline: **“Speak it into being.”**

---

## 2. Color

Colors behave like **hardware indicators**, not decoration:
Electric Blue = system processing / primary signal, Alert Red = active capture,
grounded by industrial grays.

### 2.1 Palette (raw)

| Token | Hex | Use |
|---|---|---|
| Electric Blue | `#1F3FFF` | primary signal, processing, selection |
| Electric Blue Dim | `#1730B8` | pressed/idle primary fill |
| Electric Blue Ghost | `#0E1B6E` | deep tint backgrounds |
| Alert Red | `#E60023` | active recording / capture, destructive |
| Alert Red Dim | `#B30019` | pressed danger fill |
| Terminal Green | `#3DDC97` | passive listening / ready (phosphor ref) |
| Signal Amber | `#F2B843` | warnings |
| Signal Orange | `#FF6B2C` | (reserved, currently unused) |
| Signal Violet | `#6E7BFF` | Agent / skills |
| Carbon | `#0A0A0A` | deepest surface (overlay, dark base) |
| Onyx | `#141414` | surface |
| Graphite | `#1E1E1E` | raised surface |
| Slate | `#2A2A2A` | hairline / divider (dark) |
| Ash | `#5E5E5E` | tertiary text (dark) |
| Smoke | `#9C9C9C` | secondary text (dark) |
| Fog | `#C8C8C8` | hairline (light) |
| Mist | `#E3E3E3` | raised surface (light) |
| Chalk | `#F2F2F2` | surface (light) |
| Paper | `#FFFFFF` | deepest surface (light) |

### 2.2 Semantic tokens (scheme-aware)

Accents are **identical in light & dark** (hardware-indicator principle).
Surfaces and text flip by scheme.

| Semantic | Dark | Light |
|---|---|---|
| `primary` | `#1F3FFF` | `#1F3FFF` |
| `primaryDim` | `#1730B8` | `#1730B8` |
| `alert` | `#E60023` | `#E60023` |
| `listening` | `#3DDC97` | `#3DDC97` |
| `warning` | `#F2B843` | `#F2B843` |
| `agent` | `#6E7BFF` | `#6E7BFF` |
| `surfaceDeep` | `#0A0A0A` | `#FFFFFF` |
| `surface` | `#141414` | `#F2F2F2` |
| `surfaceRaised` | `#1E1E1E` | `#E3E3E3` |
| `surfaceLine` | `#2A2A2A` | `#C8C8C8` |
| `textPrimary` | `#F5F5F5` | `#0A0A0A` |
| `textSecondary` | `#9C9C9C` | `#4A4A4A` |
| `textTertiary` | `#5E5E5E` | `#9C9C9C` |

**Overlay surfaces are always dark** (OLED-style), regardless of system mode:
`overlayFill #0A0A0A`, `overlayInk #F5F5F5`, `overlayMuted #9C9C9C`,
`overlayDim #5E5E5E`, `overlayRule white@8%`.

State → accent mapping (overlay & status):

| State | Accent |
|---|---|
| recording / capture | Alert Red |
| processing / transfer | Electric Blue |
| web search / query | Electric Blue |
| listening (always-on idle) | Terminal Green |
| success / copied / latency-ok | Terminal Green |
| error | Alert Red |
| warning / hint | Signal Amber |
| agent / skills | Signal Violet |

---

## 3. Typography

Two families:

- **Display** — *Chakra Petch* (technical geometric sans). Latin + numerals:
  accents, codes, numeric readouts, big titles. Falls back to system sans.
- **Mono** — *Sarasa Mono SC* (CJK-aware monospace). Terminal labels, status
  text, captions, body, CJK. Falls back to SF Mono / system monospace.

> Both are OFL. Sarasa is shipped as a Nerd-patched build, so font loaders must
> read the **family name from the file’s metadata**, not guess from the filename.

Type scale (pt/sp):

| Role | Size | Weight | Family |
|---|---|---|---|
| Page title | 18–28 | semibold | Display |
| Section header | 10 | semibold, tracking 0.8 | Mono, UPPERCASE |
| Row label | 12 | regular | Mono |
| Body / answer | 12–13 | regular | Mono |
| Caption / hint | 10 | regular | Mono |
| Terminal tag | 9 | semibold, tracking 0.6 | Mono, UPPERCASE |
| Numeric readout | 14 | semibold, mono digits | Display |

---

## 4. Spacing, radius, stroke

**Sharp corners, crisp hairlines, zero soft shadows.**

- Spacing scale (pt): `4 · 8 · 12 · 16 · 24 · 32` (unit = 4).
- Radius: `none 0 · xs 2 · s 4 · m 8 · l 12 · overlay 14`. Default to **small or
  zero**. Buttons/inputs/tags = sharp (0–2). Containers ≤ 12.
- Stroke: hairline `1`, regular `1.5`, heavy `2`. Borders are 1px solid lines,
  not shadows.
- Row insets: horizontal 14, vertical 10 (single source; see §6.2).

---

## 5. Motion

Snappier than iOS rubber-band — **hardware-switch feel**, not bouncy.

> Source of truth: `BrandTheme.swift` (`Animation.brand*`). This table mirrors
> the code — change both together.

| Token | Spec | Use |
|---|---|---|
| `snap` | spring response 0.30, damping 0.85 | open / expand from zero |
| `resize` | spring 0.26 / 0.86 | container resize |
| `collapse` | spring 0.18 / 0.94 | close |
| `appear` | easeOut 0.18 | content fade-in |
| `disappear` | easeIn 0.10 | content fade-out |
| `reveal` | easeOut 0.24, one-shot | accent sweep on present |
| `pulse` | easeInOut 1.0 repeat | passive listening glow |
| `blink` | easeInOut 0.55 repeat | recording LED |
| `scan` | linear 1.6 repeat | (reserved — see §6.3 scanline note) |
| `pop` | spring 0.28 / 0.62 | transient confirmations |

Principles: hard cuts over blur transitions; opacity + small move over scale;
loops are slow & subtle (hardware indicator), one-shots are quick. Never inline
ad-hoc durations/springs in views — only the tokens above.

---

## 6. Components

### 6.1 Terminal copy convention

Status & labels use a leading uppercase **tag + `//`**:

```
REC //  VOICE CAPTURE
AI //   TRANSCRIBING / THINKING
NET //  WEB SEARCH
OK //   SENT / COPIED
ERR //  <message>
LISTEN // AWAITING VOICE
```

Section headers and footers also end with `//` (e.g. `GENERAL //`, `READY //`).
Sidebar items are numbered: `01 GENERAL //`, `02 KNOWLEDGE //`.

Tags must be legible to a first-time user (`AI`, `REC`, `OK`, `NET`) — no
insider jargon. `XFER` was retired for exactly this reason: terminal
*discipline* is the brand, terminal *obscurity* is not.

### 6.2 Settings primitives (macOS reference: `BrandSettingsPrimitives.swift`)

- **Shell**: brand title strip (Electric Blue) + numbered left sidebar +
  content. Window chrome hidden; title strip is the drag handle.
- **Section**: mono UPPERCASE header (`TITLE //`) above a sharp-edged container
  with a 1px `surfaceLine` border on `surfaceRaised`.
- **Row**: label leading (mono), control trailing; optional caption beneath.
  Horizontal padding lives on the **section container**, so every child
  (rows, buttons, links, custom views) shares one inset.
- **Auto-dividers**: only *primary control rows* (Row / PickerRow / Toggle /
  WideRow) draw a 1px divider before them. Captions, hints, links, standalone
  buttons opt out — they never get fenced by lines.
- **Toggle**: square track (38×18), off = `surface` fill + gray outline,
  on = Electric Blue fill + white square knob. No pill.
- **Button**: sharp corners, mono UPPERCASE label. `primary` = blue fill;
  `secondary` = `surface` fill + gray outline; `danger` = red fill.
  Pressed = **1px downward travel** (mechanical), never fade or scale.
- **Picker**: custom dropdown (NOT system menu) — sharp, opaque `surfaceDeep`
  list, mono rows, hairline separators, selected row in Electric Blue + ✓.
- **Action row**: standalone/utility buttons right-align into the trailing
  column for consistency.
- **Status badge**: sharp chip, `tone.color` text on 12% tint + 0.5px border
  (success/warn/alert/info/neutral).
- **Chip**: sharp, optional leading icon + close ✗ (apps/webs/scenes).
- **Hint row**: colored left stripe + `TAG //` + text (TIP/WARN/ERR).
- **Caption**: mono 10, tertiary, leading-aligned.

### 6.3 Overlay / floating status (macOS: `OverlayWindowController.swift`)

- Container: carbon `#0A0A0A`, sharp 14pt bottom radius, **1px hairline rim**
  (`overlayRule`, static — deliberately *no* audio-reactive rim pulsing) + a
  tight separation shadow (radius ≤ 6 — functional contrast against light
  wallpaper, not decoration). No puffy radial blur.
- On present: a one-shot Electric Blue **reveal sweep** along the attachment
  line (`reveal` token).
- **No scanline overlay.** Tried and deliberately removed — a moving texture
  over the status line is too distracting while the user is speaking. Don't
  re-add. The terminal texture comes from type, tags and block indicators
  instead; the `scan` motion token stays reserved.
- Status line (single-row states), one fixed spec: square LED 6×6 · tag mono 9
  semibold · meter (waveform 56×22 / block-progress 64×8) · status text mono 11
  medium. Active capture LED uses `blink`; passive listening uses `pulse`.
- Waveform: square-cap bars, solid color, hardware-indicator feel, plus a
  per-bar **peak-hold tick** (VU-meter behavior: hold ~0.3s, then decay —
  instrumentation, not nostalgia).
- Processing: `[████░░░░]` block-progress scan, not a spinner. **No elapsed
  readout** — tried and removed: a counter ticking up while the user waits
  reads as anxiety, not telemetry. Live telemetry belongs on low-stakes
  surfaces (settings footer), never in the waiting moment.
- Long panels (answers): retro-mac log frame — Electric Blue title strip with
  `TAG //` + close, mono body, sharp `COPY` footer button.
- Confirm modals: Electric Blue title strip + sharp PRIMARY/SECONDARY buttons.

### 6.4 Iconography

- **App icon**: carbon squircle, electric-blue glyph. macOS: squircle fills
  ~80% of canvas (Apple grid). Android: same art adapted to adaptive-icon safe
  zone (system masks the shape).
- **Menu-bar / status mark**: a *complete, regular* monochrome glyph that holds
  a consistent bounding box with OS neighbors — rounded-square frame + double
  chevron `»` (relay/forward, echoes terminal `>`). Avoid sparse two-part marks.
- System glyphs: bold weight, sharp; prefer square/rect indicators over circles.

---

## 7. Platform notes

### macOS
- Tokens: `BrandTheme.swift`; type: `BrandTypography.swift`;
  primitives: `BrandSettingsPrimitives.swift`; overlay: `OverlayWindowController.swift`.
- Fonts ship in `Resources/Fonts/`, registered at launch; loader reads family
  from metadata. Falls back gracefully if absent.
- Dark + light both supported; overlay always dark.

### Android (View/XML)
- Tokens: `res/values/colors.xml` + `themes.xml` (brand palette + semantic).
- Surfaces: brand drawables (`@drawable/brand_*`) for sharp containers, dividers,
  buttons; mono type via `fontFamily`.
- Floating button + recording overlay mirror §6.3 within View/animator limits
  (carbon core, blue idle / red recording, square ripple, block progress).
- Adaptive launcher icon mirrors §6.4 with Android safe-zone padding.
- Motion: use the §5 durations via `ValueAnimator` / `Interpolator`
  (DecelerateInterpolator ≈ appear, fast spring-like via OvershootInterpolator
  tension ~1.5 for pop).

---

## 8. Do / Don’t

**Do:** sharp corners · 1px solid borders · mono + `//` tags · hardware-indicator
colors · snappy hard-cut motion · numbered/labeled hierarchy.

**Don’t:** rounded pills · drop-shadow-as-border · gradients-as-decoration ·
bouncy iOS springs · pastel/decorative color · centered floaty layouts.
