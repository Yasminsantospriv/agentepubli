import type { Context, Next } from "hono";
import type { AppEnv } from "../types";
import { fail } from "./response";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const PBKDF2_ITERATIONS_MIN = 100_000;

export type AuthUser = {
  sub: string;
  role: "admin";
  exp: number;
  iat: number;
};

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;

  // Formato: pbkdf2$<iterations>$<salt-base64url>$<hash-base64url>
  const [kind, iterationText, saltText, hashText] = stored.split("$");
  if (kind !== "pbkdf2" || !iterationText || !saltText || !hashText) return false;

  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < PBKDF2_ITERATIONS_MIN) return false;

  const salt = base64UrlDecode(saltText);
  const expected = new Uint8Array(base64UrlDecode(hashText));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    expected.byteLength * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

export async function signAdminToken(secret: string, ttlSeconds = TOKEN_TTL_SECONDS): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthUser = { sub: "admin", role: "admin", iat: now, exp: now + ttlSeconds };
  return signJwt(payload, secret);
}

export async function verifyAdminToken(token: string, secret: string | undefined): Promise<AuthUser | null> {
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  const expected = await hmacSha256(`${headerPart}.${payloadPart}`, secret);
  if (!timingSafeEqual(new Uint8Array(expected), new Uint8Array(base64UrlDecode(signaturePart)))) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart))) as AuthUser;
    const now = Math.floor(Date.now() / 1000);
    if (payload.sub !== "admin" || payload.role !== "admin" || !payload.exp || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function requireAuth(c: Context<AppEnv>, next: Next) {
  if (c.req.method === "OPTIONS") return next();

  const path = new URL(c.req.url).pathname;
  const publicPaths = new Set(["/", "/health", "/auth/login"]);
  if (publicPaths.has(path)) return next();

  if (!c.env.JWT_SECRET || !c.env.ADMIN_PASSWORD_HASH) {
    return fail("Autenticação administrativa ainda não foi configurada.", 503);
  }

  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return fail("Token de autenticação ausente.", 401);

  const user = await verifyAdminToken(token, c.env.JWT_SECRET);
  if (!user) return fail("Token inválido ou expirado.", 401);

  c.set("authUser", user);
  await next();
}

async function signJwt(payload: AuthUser, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadPart = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSha256(`${headerPart}.${payloadPart}`, secret);
  return `${headerPart}.${payloadPart}.${base64UrlEncode(signature)}`;
}

async function hmacSha256(data: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): ArrayBuffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
