-- 管理员账号表，与 account / relay-server 现有的 admin_users 表结构保持一致
CREATE TABLE admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin', -- 'admin' | 'superadmin'
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
