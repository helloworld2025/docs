// 生成 PBKDF2-HMAC-SHA256 密码 hash（算法与 site/shared/crypto.ts 保持一致，
// 也与 account/scripts/gen-admin-hash.mjs 完全相同，可互相复用）。
//
// 用法：node scripts/gen-admin-hash.mjs "YourPassword123"
const enc = new TextEncoder();

function b64urlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 10000, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2$10000$${b64urlEncode(salt)}$${b64urlEncode(bits)}`;
}

const password = process.argv[2] || "Relay@2026!";
const hash = await hashPassword(password);
console.log(hash);
