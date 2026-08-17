// ============================================================================
// Helper de armazenamento (R2) — imagens de referência e geradas
//
// Estrutura de chaves no bucket:
//   models/{model_slug}/references/{type}/{id}.{ext}
//   models/{model_slug}/generated/{generation_id}/{id}.{ext}
//   content/{type}/{id}.{ext}
// ============================================================================

import type { Bindings } from "../types";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function buildReferenceKey(modelSlug: string, referenceType: string, id: string, ext: string) {
  return `models/${modelSlug}/references/${referenceType.toLowerCase()}/${id}.${ext}`;
}

export function buildGeneratedKey(modelSlug: string, generationId: string, id: string, ext: string) {
  return `models/${modelSlug}/generated/${generationId}/${id}.${ext}`;
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

export class StorageValidationError extends Error {}

/** Valida tamanho e MIME type antes de qualquer upload para o R2. */
export function validateUpload(file: { size: number; type: string }) {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new StorageValidationError(`Tipo de arquivo não permitido: ${file.type}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new StorageValidationError(`Arquivo excede o limite de ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
  }
}

export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream,
  contentType: string
) {
  await bucket.put(key, data, {
    httpMetadata: { contentType },
  });
  return key;
}

/** Gera uma URL pública temporária de leitura. Requer que o bucket tenha domínio público configurado,
 *  ou substitua por um endpoint /assets/:key que faz streaming via bucket.get() (ver routes). */
export function publicUrlFor(env: Bindings, key: string, publicBaseUrl?: string) {
  if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
  return `/assets/${key}`;
}

export async function deleteFromR2(bucket: R2Bucket, key: string) {
  await bucket.delete(key);
}
