const encoder = new TextEncoder();

export function jsonResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export async function readJson<T>(request: Request, maxBytes = 64_000): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("Request body too large");
  const bytes = await readStreamLimited(request.body, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function readStreamLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Payload exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toDataUrl(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

export function extractJson<T>(value: string): T {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI returned invalid JSON");
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return base64ToBytes(padded);
}

export function detectImageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return "application/octet-stream";
}

export function imageDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (contentType === "image/png" && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (contentType === "image/jpeg" && bytes.length >= 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) break;
      const segmentLength = view.getUint16(offset + 2);
      if (segmentLength < 2 || offset + segmentLength + 2 > bytes.length) break;
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
        && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isStartOfFrame) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += segmentLength + 2;
    }
  }

  if (contentType === "image/webp" && bytes.length >= 30) {
    const chunk = new TextDecoder().decode(bytes.subarray(12, 16));
    if (chunk === "VP8X") {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { width, height };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
  }

  return null;
}

export function hashtags(value: string): string[] {
  const matches = value.toLowerCase().matchAll(/#([\p{L}\p{N}_]{3,50})/gu);
  return [...new Set([...matches].map((match) => match[1]))];
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
