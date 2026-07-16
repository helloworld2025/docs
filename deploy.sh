#!/usr/bin/env bash
# ============================================================
# docs — 本地一键部署到 Cloudflare Pages（生产环境，无需 GitHub Actions）
#
# 用法：
#   cd docs
#   bash deploy.sh
#
# 前置条件：
#   - 已 `wrangler login`
#   - 存在 docs/.env.secrets（cp .env.secrets.example .env.secrets 并填写）
#
# 首次运行会自动创建 D1 数据库 / Pages 项目 / 迁移表 / 管理员账号 / secrets，
# 之后重复运行只会跳过已存在的资源，安全可重复执行（幂等）。
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

note() { echo -e "${CYAN}▶ $*${NC}"; }
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
die()  { echo -e "${RED}✗ $*${NC}" >&2; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$ROOT_DIR/site"
EDITOR_DIR="$SITE_DIR/editor"

# ── 加载配置 ────────────────────────────────────────────────
[ -f "$ROOT_DIR/deploy.config.sh" ] || die "缺少 deploy.config.sh"
# shellcheck disable=SC1091
source "$ROOT_DIR/deploy.config.sh"

if [ ! -f "$ROOT_DIR/.env.secrets" ]; then
  die "缺少 docs/.env.secrets，请先执行: cp .env.secrets.example .env.secrets 并填写真实值"
fi
set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env.secrets"
set +a

[ -n "${ADMIN_JWT_SECRET:-}" ] || die ".env.secrets 缺少 ADMIN_JWT_SECRET"
[ -n "${ADMIN_PASSWORD:-}" ]   || die ".env.secrets 缺少 ADMIN_PASSWORD"

command -v npx >/dev/null || die "未找到 npx，请先安装 Node.js"

echo -e "${BOLD}${CYAN}🚀 docs 本地部署 — 项目: ${PAGES_PROJECT} / D1: ${D1_NAME}${NC}\n"

# ── Step 1：同步文档 ────────────────────────────────────────
note "[1/8] 同步文档（account/relay/analytics → site/docs 镜像）"
node "$ROOT_DIR/scripts/sync-sources.mjs"

# ── Step 2：安装依赖 ────────────────────────────────────────
note "[2/8] 安装依赖"
(cd "$SITE_DIR" && npm install)
(cd "$EDITOR_DIR" && npm install)

# ── Step 3：确保 D1 数据库存在 ──────────────────────────────
note "[3/8] 检查 D1 数据库: $D1_NAME"
D1_LIST_JSON=$(cd "$SITE_DIR" && npx wrangler d1 list --json 2>/dev/null || echo "[]")
D1_ID=$(echo "$D1_LIST_JSON" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const r=d.find(x=>x.name==='$D1_NAME');
  console.log(r?r.uuid:'');
")

if [ -z "$D1_ID" ]; then
  note "  未找到，创建中..."
  CREATE_OUT=$(cd "$SITE_DIR" && npx wrangler d1 create "$D1_NAME" 2>&1) || true
  echo "$CREATE_OUT"
  D1_ID=$(echo "$CREATE_OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$D1_ID" ] || die "无法解析新建 D1 的 database_id，请手动检查并填入 site/wrangler.toml"
  ok "D1 database_id = $D1_ID"
else
  ok "D1 已存在: $D1_ID"
fi

# 回写 database_id 到 wrangler.toml（幂等：替换占位符或已有 id 均可）
node -e "
  const fs=require('fs');
  const p='$SITE_DIR/wrangler.toml';
  let s=fs.readFileSync(p,'utf8');
  s=s.replace(/database_id\s*=\s*\"[^\"]*\"/, 'database_id    = \"$D1_ID\"');
  fs.writeFileSync(p,s);
"

# ── Step 4：确保 Pages 项目存在 ─────────────────────────────
note "[4/8] 检查 Pages 项目: $PAGES_PROJECT"
if (cd "$SITE_DIR" && npx wrangler pages project list 2>/dev/null | grep -q "$PAGES_PROJECT"); then
  ok "Pages 项目已存在"
else
  note "  未找到，创建中..."
  (cd "$SITE_DIR" && npx wrangler pages project create "$PAGES_PROJECT" --production-branch main)
  ok "Pages 项目创建完成"
fi

# ── Step 5：D1 迁移（远程）──────────────────────────────────
note "[5/8] 应用 D1 迁移（remote）"
(cd "$SITE_DIR" && npx wrangler d1 migrations apply "$D1_NAME" --remote)

# ── Step 6：创建/更新管理员账号 ─────────────────────────────
note "[6/8] 生成管理员账号 hash 并写入 D1"
ADMIN_HASH=$(node "$ROOT_DIR/scripts/gen-admin-hash.mjs" "$ADMIN_PASSWORD")
(cd "$SITE_DIR" && npx wrangler d1 execute "$D1_NAME" --remote --command \
  "INSERT INTO admin_users (id, email, password_hash, role) VALUES ('adm_1', '${ADMIN_EMAIL}', '${ADMIN_HASH}', 'superadmin') ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash")
ok "管理员账号就绪: $ADMIN_EMAIL"

# ── Step 7：写入 Secrets ────────────────────────────────────
note "[7/8] 写入 Cloudflare Pages Secrets"
printf '%s' "$ADMIN_JWT_SECRET" | (cd "$SITE_DIR" && npx wrangler pages secret put ADMIN_JWT_SECRET --project-name "$PAGES_PROJECT")
printf '%s' "$TURNSTILE_SECRET" | (cd "$SITE_DIR" && npx wrangler pages secret put TURNSTILE_SECRET --project-name "$PAGES_PROJECT")
if [ -n "${GITHUB_TOKEN:-}" ]; then
  printf '%s' "$GITHUB_TOKEN" | (cd "$SITE_DIR" && npx wrangler pages secret put GITHUB_TOKEN --project-name "$PAGES_PROJECT")
else
  warn "GITHUB_TOKEN 未配置，在线编辑器的读取/保存功能将不可用（其余功能不受影响）"
fi

# 同步 TURNSTILE_SITE_KEY 到 wrangler.toml（非 secret，明文 vars）
node -e "
  const fs=require('fs');
  const p='$SITE_DIR/wrangler.toml';
  let s=fs.readFileSync(p,'utf8');
  s=s.replace(/TURNSTILE_SITE_KEY\s*=\s*\"[^\"]*\"/, 'TURNSTILE_SITE_KEY = \"$TURNSTILE_SITE_KEY\"');
  fs.writeFileSync(p,s);
"

# ── Step 8：构建 + 部署 ─────────────────────────────────────
note "[8/8] 构建站点并部署"
(cd "$EDITOR_DIR" && npm run build)
(cd "$SITE_DIR" && node scripts/gen-nav.mjs && npx vitepress build docs)
(cd "$SITE_DIR" && npx wrangler pages deploy docs/.vitepress/dist --project-name "$PAGES_PROJECT" --commit-dirty=true)

echo ""
echo -e "${BOLD}${GREEN}✅ 部署完成！${NC}"
echo -e "  🌐 Pages 默认域名 → https://${PAGES_PROJECT}.pages.dev"
echo -e "  🌐 自定义域名（需在 Cloudflare Dashboard 手动绑定一次）→ https://${DOCS_DOMAIN}"
echo -e "  🔑 登录账号 → ${ADMIN_EMAIL} / (.env.secrets 中的 ADMIN_PASSWORD)"
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo -e "  ${YELLOW}提示：GITHUB_TOKEN 未配置，之后补充请在 .env.secrets 填入后重新运行本脚本${NC}"
fi
