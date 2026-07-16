#!/usr/bin/env bash
# ============================================================
# docs — 一键本地开发环境
#
# 默认（纯内容预览，日常写文档用）：
#   bash dev.sh
#   → 同步文档 + vitepress dev，热更新，http://localhost:5173
#
# 完整模式（联调登录 / 在线编辑器 / API，需要 wrangler pages dev + D1 local）：
#   bash dev.sh --full
# ============================================================
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

note() { echo -e "${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$ROOT_DIR/site"
EDITOR_DIR="$SITE_DIR/editor"

FULL_MODE=0
if [ "${1:-}" == "--full" ]; then
  FULL_MODE=1
fi

# ── Step 1：同步文档（本地模式，读取同级 account/relay/analytics 目录）──
note "同步文档..."
node "$ROOT_DIR/scripts/sync-sources.mjs"

# ── Step 2：安装依赖 ────────────────────────────────────────
if [ ! -d "$SITE_DIR/node_modules" ]; then
  note "安装 site 依赖..."
  (cd "$SITE_DIR" && npm install)
fi

if [ "$FULL_MODE" -eq 0 ]; then
  # ── 纯内容预览 ──────────────────────────────────────────
  echo -e "${BOLD}${GREEN}🚀 纯内容预览模式（无登录/无编辑器 API）${NC}"
  echo -e "  访问 ${BOLD}http://localhost:5173${NC}，改 md 热更新"
  echo -e "  ${YELLOW}提示：如需联调登录/在线编辑器，使用 bash dev.sh --full${NC}\n"
  exec npm --prefix "$SITE_DIR" run dev
fi

# ── 完整模式 ──────────────────────────────────────────────
echo -e "${BOLD}${CYAN}🚀 完整模式（登录 + 在线编辑器 + API）${NC}"

if [ ! -d "$EDITOR_DIR/node_modules" ]; then
  note "安装 editor 依赖..."
  (cd "$EDITOR_DIR" && npm install)
fi

# .dev.vars：本地开发用的 Cloudflare Pages Functions 环境变量
DEV_VARS="$SITE_DIR/.dev.vars"
if [ ! -f "$DEV_VARS" ]; then
  note "生成 ${DEV_VARS} (本地开发默认值)..."

  LOCAL_JWT_SECRET=$(openssl rand -base64 48)
  GH_TOKEN_LINE="GITHUB_TOKEN="
  if [ -f "$ROOT_DIR/.env.secrets" ]; then
    # 复用 .env.secrets 里已配置的 GITHUB_TOKEN（如果有）
    EXISTING_TOKEN=$(grep -E '^GITHUB_TOKEN=' "$ROOT_DIR/.env.secrets" | cut -d= -f2- || true)
    [ -n "$EXISTING_TOKEN" ] && GH_TOKEN_LINE="GITHUB_TOKEN=$EXISTING_TOKEN"
  fi
  cat > "$DEV_VARS" <<EOF
ADMIN_JWT_SECRET=$LOCAL_JWT_SECRET
TURNSTILE_SECRET=
TURNSTILE_SITE_KEY=
$GH_TOKEN_LINE
EOF
  ok "$DEV_VARS 已生成"
  ok "  TURNSTILE_SECRET 留空 -> 后端跳过人机校验"
  ok "  TURNSTILE_SITE_KEY 留空 -> .dev.vars 会覆盖 wrangler.toml 的 [vars]，前端登录页也不再渲染验证码组件"

fi

# 本地 D1 迁移
note "应用本地 D1 迁移..."
(cd "$SITE_DIR" && npx wrangler d1 migrations apply docs-pro --local)

# 本地管理员账号：优先复用 deploy.config.sh 的 ADMIN_EMAIL + .env.secrets 的
# ADMIN_PASSWORD（跟生产用同一套账号，方便记忆）；缺失时回退到本地测试账号
# admin@local.test / admin123，保证没配置密钥文件也能跑起来本地开发。
LOCAL_ADMIN_EMAIL="admin@local.test"
LOCAL_ADMIN_PASSWORD="admin123"

if [ -f "$ROOT_DIR/deploy.config.sh" ]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/deploy.config.sh"
  [ -n "${ADMIN_EMAIL:-}" ] && LOCAL_ADMIN_EMAIL="$ADMIN_EMAIL"
fi
if [ -f "$ROOT_DIR/.env.secrets" ]; then
  EXISTING_PASSWORD=$(grep -E '^ADMIN_PASSWORD=' "$ROOT_DIR/.env.secrets" | cut -d= -f2- || true)
  [ -n "$EXISTING_PASSWORD" ] && LOCAL_ADMIN_PASSWORD="$EXISTING_PASSWORD"
fi

# 按 email 判断是否已存在（而非"表是否为空"），保证重复运行安全幂等，
# 也允许 admin@local.test 等历史测试账号与新账号共存。
ADMIN_EXISTS=$(cd "$SITE_DIR" && npx wrangler d1 execute docs-pro --local --command \
  "SELECT count(*) as c FROM admin_users WHERE email = '${LOCAL_ADMIN_EMAIL}'" --json 2>/dev/null | node -e "
  let data='';
  process.stdin.on('data',d=>data+=d);
  process.stdin.on('end',()=>{
    try {
      const j = JSON.parse(data);
      console.log(j[0]?.results?.[0]?.c ?? 0);
    } catch { console.log(0); }
  });
" || echo 0)

if [ "$ADMIN_EXISTS" == "0" ]; then
  warn "本地 D1 还没有账号 ${LOCAL_ADMIN_EMAIL}，创建中..."
  HASH=$(node "$ROOT_DIR/scripts/gen-admin-hash.mjs" "$LOCAL_ADMIN_PASSWORD")
  ADMIN_ID="adm_$(echo -n "$LOCAL_ADMIN_EMAIL" | shasum | cut -c1-10)"
  (cd "$SITE_DIR" && npx wrangler d1 execute docs-pro --local --command \
    "INSERT INTO admin_users (id, email, password_hash, role) VALUES ('${ADMIN_ID}', '${LOCAL_ADMIN_EMAIL}', '${HASH}', 'superadmin')")
  ok "本地登录账号: ${LOCAL_ADMIN_EMAIL} / ${LOCAL_ADMIN_PASSWORD}"
else
  ok "本地登录账号已存在: ${LOCAL_ADMIN_EMAIL}"
fi


# 构建 editor + 站点静态产物（wrangler pages dev 需要构建产物）
note "构建 editor SPA..."
(cd "$EDITOR_DIR" && npm run build)

note "构建站点..."
(cd "$SITE_DIR" && node scripts/gen-nav.mjs && npx vitepress build docs)

echo -e "\n${BOLD}${GREEN}✅ 启动 wrangler pages dev（完整模式）${NC}"
echo -e "  访问 ${BOLD}http://localhost:8788${NC}（默认端口，以实际输出为准）\n"
# 必须在 site/ 目录下执行：wrangler 需要在此目录找到 wrangler.toml（D1 绑定/vars）、
# functions/（登录、编辑器等 Pages Functions）、.dev.vars（本地环境变量）。
# 在别的目录跑会导致 "No Functions. Shimming..."（登录、编辑器 API 全部不可用）。
cd "$SITE_DIR"
exec npx wrangler pages dev docs/.vitepress/dist --local --compatibility-date=2024-12-01 --compatibility-flags=nodejs_compat

