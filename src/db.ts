import type {
  CreativeBrief,
  GeneratedAsset,
  IdentityRef,
  JsonObject,
  RunContext,
  TrendCandidate,
  TriggerType,
  WatchSource
} from "./types";
import { isRecord, nowIso } from "./utils";

function parseObject(value: string | null, fallback: JsonObject = {}): JsonObject {
  if (!value) return fallback;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed as JsonObject : fallback;
  } catch {
    return fallback;
  }
}

export async function getSetting(db: D1Database, key: string): Promise<JsonObject> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return parseObject(row?.value ?? null);
}

export async function getRunContext(db: D1Database): Promise<RunContext> {
  const [identityResult, sourceResult, brandProfile, captionStyle, contentPolicy] = await Promise.all([
    db.prepare("SELECT id, r2_key, label, content_type, width, height, active FROM identity_refs WHERE active = 1 ORDER BY created_at LIMIT 3").all<IdentityRef>(),
    db.prepare("SELECT id, platform, handle, external_url, declared_age, adult_verified_at, notes, active FROM watch_sources WHERE active = 1 ORDER BY platform, created_at LIMIT 50").all<WatchSource>(),
    getSetting(db, "brand_profile"),
    getSetting(db, "caption_style"),
    getSetting(db, "content_policy")
  ]);
  return {
    identityRefs: identityResult.results,
    sources: sourceResult.results,
    brandProfile,
    captionStyle,
    contentPolicy
  };
}

export async function ensureRun(
  db: D1Database,
  runId: string,
  workflowId: string,
  trigger: TriggerType
): Promise<void> {
  await db.prepare(
    "INSERT OR IGNORE INTO runs (id, workflow_id, trigger_type, status, created_at, updated_at) VALUES (?, ?, ?, 'running', ?, ?)"
  ).bind(runId, workflowId, trigger, nowIso(), nowIso()).run();
  await db.prepare("UPDATE runs SET status = 'running', updated_at = ?, error_message = NULL WHERE id = ?")
    .bind(nowIso(), runId).run();
}

export async function updateRun(
  db: D1Database,
  runId: string,
  fields: Record<string, string | number | null>
): Promise<void> {
  const allowed = new Set([
    "status", "selected_candidate_id", "selected_platform", "selected_source_url", "selected_reference_key",
    "concept", "brief_json", "caption", "moderation_json", "error_message", "decision", "decision_notes", "decided_at"
  ]);
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  if (entries.length === 0) return;
  const assignments = [...entries.map(([key]) => `${key} = ?`), "updated_at = ?"].join(", ");
  const values = [...entries.map(([, value]) => value), nowIso(), runId];
  await db.prepare(`UPDATE runs SET ${assignments} WHERE id = ?`).bind(...values).run();
}

export async function insertCandidates(db: D1Database, runId: string, candidates: TrendCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const statements = candidates.slice(0, 50).map((candidate) => db.prepare(
    `INSERT OR REPLACE INTO trend_candidates
      (id, run_id, platform, creator_handle, source_url, image_url, caption, metrics_json, published_at, score, adult_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    candidate.id,
    runId,
    candidate.platform,
    candidate.creatorHandle,
    candidate.sourceUrl,
    candidate.imageUrl,
    candidate.caption,
    JSON.stringify({ ...candidate.metrics, matchedSignals: candidate.matchedSignals }),
    candidate.publishedAt,
    candidate.score,
    candidate.adultVerified ? 1 : 0
  ));
  await db.batch(statements);
}

export async function saveAsset(db: D1Database, runId: string, asset: GeneratedAsset): Promise<void> {
  await db.prepare(
    `INSERT INTO run_assets
      (id, run_id, position, r2_key, content_type, width, height, prompt, audit_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, position) DO UPDATE SET
        r2_key = excluded.r2_key,
        content_type = excluded.content_type,
        width = excluded.width,
        height = excluded.height,
        prompt = excluded.prompt,
        audit_json = excluded.audit_json,
        status = excluded.status,
        created_at = CURRENT_TIMESTAMP`
  ).bind(
    crypto.randomUUID(), runId, asset.position, asset.key, asset.contentType, asset.width, asset.height,
    asset.prompt, JSON.stringify(asset.audit), asset.status
  ).run();
}

export async function listSources(db: D1Database): Promise<WatchSource[]> {
  const result = await db.prepare(
    "SELECT id, platform, handle, external_url, declared_age, adult_verified_at, notes, active FROM watch_sources ORDER BY active DESC, platform, created_at DESC"
  ).all<WatchSource>();
  return result.results;
}

export async function addSource(db: D1Database, source: WatchSource): Promise<void> {
  await db.prepare(
    `INSERT INTO watch_sources
      (id, platform, handle, external_url, declared_age, adult_verified_at, notes, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    source.id, source.platform, source.handle, source.external_url, source.declared_age,
    source.adult_verified_at, source.notes, source.active, nowIso(), nowIso()
  ).run();
}

export async function setSourceActive(db: D1Database, id: string, active: boolean): Promise<boolean> {
  const result = await db.prepare("UPDATE watch_sources SET active = ?, updated_at = ? WHERE id = ?")
    .bind(active ? 1 : 0, nowIso(), id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listIdentityRefs(db: D1Database): Promise<IdentityRef[]> {
  const result = await db.prepare(
    "SELECT id, r2_key, label, content_type, width, height, active FROM identity_refs ORDER BY active DESC, created_at"
  ).all<IdentityRef>();
  return result.results;
}

export async function addIdentityRef(db: D1Database, ref: IdentityRef): Promise<void> {
  await db.prepare(
    `INSERT INTO identity_refs (id, r2_key, label, content_type, width, height, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(ref.id, ref.r2_key, ref.label, ref.content_type, ref.width, ref.height, ref.active, nowIso()).run();
}

export async function setIdentityRefActive(db: D1Database, id: string, active: boolean): Promise<boolean> {
  const result = await db.prepare("UPDATE identity_refs SET active = ? WHERE id = ?")
    .bind(active ? 1 : 0, id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listRuns(db: D1Database, limit = 20): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    `SELECT id, workflow_id, trigger_type, status, selected_platform, selected_source_url, concept,
      caption, decision, decided_at, error_message, created_at, updated_at
     FROM runs ORDER BY created_at DESC LIMIT ?`
  ).bind(Math.max(1, Math.min(limit, 50))).all<Record<string, unknown>>();
  return result.results;
}

export async function getRun(db: D1Database, runId: string): Promise<{
  run: Record<string, unknown>;
  assets: Array<Record<string, unknown> & { r2_key: string }>;
  candidates: Record<string, unknown>[];
} | null> {
  const run = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first<Record<string, unknown>>();
  if (!run) return null;
  const [assets, candidates] = await Promise.all([
    db.prepare(
      "SELECT id, position, r2_key, content_type, width, height, status, audit_json, created_at FROM run_assets WHERE run_id = ? ORDER BY position"
    ).bind(runId).all<Record<string, unknown> & { r2_key: string }>(),
    db.prepare(
      "SELECT id, platform, creator_handle, source_url, caption, metrics_json, published_at, score FROM trend_candidates WHERE run_id = ? ORDER BY score DESC LIMIT 10"
    ).bind(runId).all<Record<string, unknown>>()
  ]);
  return { run, assets: assets.results, candidates: candidates.results };
}

export async function getRegenerationSeed(db: D1Database, runId: string): Promise<{
  brief: CreativeBrief;
  selectedCandidateId: string | null;
  selectedPlatform: string | null;
  selectedSourceUrl: string | null;
  selectedReferenceKey: string | null;
} | null> {
  const row = await db.prepare(
    `SELECT brief_json, selected_candidate_id, selected_platform, selected_source_url, selected_reference_key
     FROM runs WHERE id = ?`
  ).bind(runId).first<{
    brief_json: string | null;
    selected_candidate_id: string | null;
    selected_platform: string | null;
    selected_source_url: string | null;
    selected_reference_key: string | null;
  }>();
  if (!row?.brief_json) return null;
  try {
    const brief = JSON.parse(row.brief_json) as CreativeBrief;
    return {
      brief,
      selectedCandidateId: row.selected_candidate_id,
      selectedPlatform: row.selected_platform,
      selectedSourceUrl: row.selected_source_url,
      selectedReferenceKey: row.selected_reference_key
    };
  } catch {
    return null;
  }
}
