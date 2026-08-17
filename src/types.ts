export type Platform = "instagram" | "tiktok";
export type TriggerType = "manual" | "scheduled" | "regenerate";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ContentWorkflowParams {
  runId?: string;
  trigger?: TriggerType;
  sourceRunId?: string;
}

export interface WatchSource {
  id: string;
  platform: Platform;
  handle: string | null;
  external_url: string | null;
  declared_age: number;
  adult_verified_at: string;
  notes: string | null;
  active: number;
}

export interface IdentityRef {
  id: string;
  r2_key: string;
  label: string;
  content_type: string;
  width: number;
  height: number;
  active: number;
}

export interface CandidateMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  followers?: number;
  rank?: number;
  sourceWeight?: number;
}

export interface TrendCandidate {
  id: string;
  platform: Platform;
  creatorHandle: string | null;
  sourceUrl: string;
  imageUrl: string | null;
  caption: string;
  metrics: CandidateMetrics;
  publishedAt: string | null;
  declaredAge: number | null;
  adultVerified: boolean;
  score: number;
  matchedSignals: string[];
}

export interface CreativeBrief {
  concept: string;
  scene: string;
  framing: string;
  lighting: string;
  wardrobe: string;
  pose: string;
  mood: string;
  colorPalette: string[];
  viralHook: string;
  originalityChange: string;
  prohibitedCopiedDetails: string[];
  platformSafe: boolean;
  safetyNotes: string;
}

export interface ImageAudit {
  safePlatform: boolean;
  appearsAdult: boolean;
  identityConsistency: number;
  hasTattoo: boolean;
  hasGlasses: boolean;
  hasLipPiercing: boolean;
  nudity: boolean;
  explicitContent: boolean;
  watermarkOrLogo: boolean;
  copiedReferenceIdentity: boolean;
  anatomyQuality: number;
  reason: string;
}

export interface GeneratedAsset {
  key: string;
  contentType: string;
  width: number;
  height: number;
  prompt: string;
  audit: ImageAudit;
  status: "passed" | "blocked";
  position: number;
}

export interface RunContext {
  identityRefs: IdentityRef[];
  sources: WatchSource[];
  brandProfile: JsonObject;
  captionStyle: JsonObject;
  contentPolicy: JsonObject;
}

export interface SignedAsset {
  id: string;
  position: number;
  contentType: string;
  status: string;
  url: string;
}

export interface InstagramMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}
