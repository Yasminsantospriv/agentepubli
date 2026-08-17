import { base64Url, fromBase64Url } from "./utils";

const encoder = new TextEncoder();

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function isAuthorized(request: Request, expectedToken: string | undefined): Promise<boolean> {
  if (!expectedToken) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7).trim();
  if (!supplied || supplied.length > 512) return false;
  const [left, right] = await Promise.all([digest(supplied), digest(expectedToken)]);
  return constantTimeEqual(left, right);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signAsset(
  key: string,
  expires: number,
  secret: string
): Promise<string> {
  const hmacKey = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(`${key}\n${expires}`));
  return base64Url(new Uint8Array(signature));
}

export async function verifyAssetSignature(
  key: string,
  expires: number,
  signature: string,
  secret: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1_000);
  if (!Number.isInteger(expires) || expires < now || expires > now + 7 * 24 * 60 * 60) return false;
  try {
    const hmacKey = await importHmacKey(secret);
    return await crypto.subtle.verify(
      "HMAC",
      hmacKey,
      new Uint8Array(fromBase64Url(signature)).buffer,
      encoder.encode(`${key}\n${expires}`)
    );
  } catch {
    return false;
  }
}

export async function signedAssetUrl(origin: string, key: string, secret: string, ttlSeconds = 86_400): Promise<string> {
  const expires = Math.floor(Date.now() / 1_000) + ttlSeconds;
  const signature = await signAsset(key, expires, secret);
  const url = new URL("/api/asset", origin);
  url.searchParams.set("key", key);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);
  return url.toString();
}

export function corsHeaders(request: Request, allowedOrigin: string): HeadersInit {
  const origin = request.headers.get("origin");
  if (!origin || origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}
