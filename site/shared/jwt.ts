// 极简 HS256 JWT 签发/校验，逻辑对齐 relay-server 的 auth/admin.rs（sign_admin_jwt / verify_admin_jwt）。
import { b64urlEncode, b64urlDecode, timingSafeEqual } from "./crypto";

const enc = new TextEncoder();

export interface AdminClaims {
  sub: string; // admin id
  email: string;
  role: string;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signAdminJwt(
  claims: Omit<AdminClaims, "iat" | "exp">,
  secret: string,
  ttlSec: number
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSec;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: AdminClaims = { ...claims, iat, exp };

  const headerPart = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadPart = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerPart}.${payloadPart}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  const sigPart = b64urlEncode(sig);

  return `${signingInput}.${sigPart}`;
}

export async function verifyAdminJwt(token: string, secret: string): Promise<AdminClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, sigPart] = parts;
  const signingInput = `${headerPart}.${payloadPart}`;

  const key = await hmacKey(secret);
  const expectedSig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  const expectedSigPart = b64urlEncode(expectedSig);
  if (!timingSafeEqual(expectedSigPart, sigPart)) return null;

  let payload: AdminClaims;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadPart)));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return null;

  return payload;
}
