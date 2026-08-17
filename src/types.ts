// ============================================================================
// Tipos globais e bindings do ambiente Cloudflare Workers
// ============================================================================

export type Bindings = {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  CACHE: KVNamespace;
  AI: Ai;

  ENVIRONMENT: string;
  FREE_FIRST_MODE: string;
  TEXT_AI_MODEL?: string;
  ALLOWED_ORIGIN?: string;

  // Secrets (configurados via `wrangler secret put`)
  OPENAI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  REPLICATE_API_TOKEN?: string;
  FAL_API_KEY?: string;
  STABILITY_API_KEY?: string;
  ADMIN_PASSWORD_HASH?: string;
  JWT_SECRET?: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    authUser?: { sub: string; role: "admin"; exp: number; iat: number };
  };
};

// --- Enums espelhando os CHECK constraints do schema.sql ---

export type ReferenceType = "FACE" | "BODY" | "HAIR" | "MASTER" | "STYLE" | "TEMPORARY";
export type IdentityLock = "OFF" | "NORMAL" | "STRONG" | "MAXIMUM";
export type GenerationFormat = "1:1" | "4:5" | "9:16" | "landscape" | "custom";
export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ProviderStatus = "NOT_CONFIGURED" | "ONLINE" | "OFFLINE" | "ERROR";
export type ContentType = "post" | "story" | "reel" | "carousel" | "reference";
export type ContentStatus = "DRAFT" | "READY" | "APPROVED" | "PUBLISHED" | "ARCHIVED";
export type Platform = "instagram" | "tiktok" | "threads" | "x" | "youtube";
