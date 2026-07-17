#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# docs — 部署明文配置（非敏感，允许提交到代码库）
# 敏感值（JWT secret / Turnstile secret / GitHub token / 管理员密码）
# 见同目录下的 .env.secrets（已 gitignore）。
#
# Cloudflare 侧资源统一加 -pro 后缀，为未来拆分 test/pro 等多环境预留命名空间。
# ══════════════════════════════════════════════════════════════════

# Cloudflare Pages 项目名
PAGES_PROJECT="docs-pro"

# Cloudflare D1 数据库名
D1_NAME="docs-pro"

# 自定义域名（仅供部署完成后提示使用，脚本不自动绑定）
DOCS_DOMAIN="docs.relay.tech"

# Cloudflare Turnstile site key（非密钥，前端可见）
TURNSTILE_SITE_KEY="0x4AAAAAAD2cImzps5sZDur6"

# 初始管理员邮箱（密码见 .env.secrets 的 ADMIN_PASSWORD）
ADMIN_EMAIL="robin@relay.tech"
