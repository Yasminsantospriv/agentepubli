import type { Bindings } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { getSetting, setSetting } from "../lib/app-settings";
import { newId, nowIso } from "../lib/response";

export type InstagramInspiration = {
  id: string;
  external_media_id: string;
  username: string | null;
  media_type: string | null;
  caption: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  like_count: number;
  comments_count: number;
  followers_count: number;
  engagement_rate: number;
  score: number;
  source_hashtag: string | null;
  ai_ready_key: string | null;
  status: string;
  published_at: string | null;
  detected_at: string;
  updated_at: string;
};

type MetaMedia = {
  id: string;
  username?: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

type MetaList<T> = { data?: T[]; error?: { message?: string; type?: string; code?: number } };
type MetaHashtagSearch = { data?: Array<{ id: string }>; error?: { message?: string; code?: number } };
type MetaBusinessDiscovery = {
  business_discovery?: { username?: string; followers_count?: number; media_count?: number };
  error?: { message?: string; code?: number };
};

export type InstagramScanResult = {
  skipped: boolean;
  configured: boolean;
  hashtags_checked: number;
  posts_seen: number;
  posts_saved: number;
  ran_at: string;
  message?: string;
};

const DEFAULT_INTERVAL_MINUTES = 120;
const DEFAULT_HASHTAGS = [
  "fashion",
  "ootd",
  "beauty",
  "lifestyle",
  "model",
  "lookdodia",
  "modafeminina",
  "selfie",
];
const DEFAULT_GRAPH_VERSION = "v25.0";

export async function ensureInstagramSchema(env: Bindings) {
  await dbRun(
    env.DB,
    `CREATE TABLE IF NOT EXISTS instagram_inspirations (
      id TEXT PRIMARY KEY,
      external_media_id TEXT NOT NULL UNIQUE,
      username TEXT,
      media_type TEXT,
      caption TEXT,
      media_url TEXT,
      thumbnail_url TEXT,
      permalink TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      followers_count INTEGER NOT NULL DEFAULT 0,
      engagement_rate REAL NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      source_hashtag TEXT,
      ai_ready_key TEXT,
      status TEXT NOT NULL DEFAULT 'DISCOVERED',
      published_at TEXT,
      detected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  await dbRun(env.DB, "CREATE INDEX IF NOT EXISTS idx_instagram_inspirations_score ON instagram_inspirations(score DESC, published_at DESC)");
  await dbRun(env.DB, "CREATE INDEX IF NOT EXISTS idx_instagram_inspirations_status ON instagram_inspirations(status, updated_at DESC)");
}

export async function getInstagramStatus(env: Bindings) {
  await ensureInstagramSchema(env);
  const [lastRun, lastResult, hashtags, intervalMinutes] = await Promise.all([
    getSetting<string | null>(env.DB, "instagram_scanner_last_run", null),
    getSetting<InstagramScanResult | null>(env.DB, "instagram_scanner_last_result", null),
    getSetting<string[]>(env.DB, "instagram_scanner_hashtags", DEFAULT_HASHTAGS),
    getSetting<number>(env.DB, "instagram_scanner_interval_minutes", DEFAULT_INTERVAL_MINUTES),
  ]);
  return {
    configured: Boolean(env.META_ACCESS_TOKEN && env.META_IG_USER_ID),
    graph_version: env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    last_run: lastRun,
    last_result: lastResult,
    interval_minutes: intervalMinutes,
    hashtags,
  };
}

export async function saveInstagramConfig(env: Bindings, input: { hashtags?: string[]; interval_minutes?: number }) {
  if (Array.isArray(input.hashtags)) {
    const hashtags = input.hashtags
      .map((item) => normalizeHashtag(item))
      .filter(Boolean)
      .slice(0, 20);
    await setSetting(env.DB, "instagram_scanner_hashtags", hashtags.length ? hashtags : DEFAULT_HASHTAGS);
  }
  if (input.interval_minutes != null) {
    const interval = Math.max(60, Math.min(720, Number(input.interval_minutes) || DEFAULT_INTERVAL_MINUTES));
    await setSetting(env.DB, "instagram_scanner_interval_minutes", interval);
  }
  return getInstagramStatus(env);
}

export async function listInstagramInspirations(env: Bindings, limit = 40) {
  await ensureInstagramSchema(env);
  return dbAll<InstagramInspiration>(
    env.DB,
    `SELECT * FROM instagram_inspirations
     ORDER BY CASE status WHEN 'SELECTED' THEN 0 ELSE 1 END, score DESC, published_at DESC
     LIMIT ?`,
    Math.max(1, Math.min(100, limit))
  );
}

export async function runInstagramScanner(env: Bindings, options: { force?: boolean } = {}): Promise<InstagramScanResult> {
  await ensureInstagramSchema(env);
  const configured = Boolean(env.META_ACCESS_TOKEN && env.META_IG_USER_ID);
  const ranAt = nowIso();
  if (!configured) {
    const result: InstagramScanResult = {
      skipped: true,
      configured: false,
      hashtags_checked: 0,
      posts_seen: 0,
      posts_saved: 0,
      ran_at: ranAt,
      message: "Conecte META_ACCESS_TOKEN e META_IG_USER_ID para ativar o scanner do Instagram.",
    };
    await setSetting(env.DB, "instagram_scanner_last_result", result);
    return result;
  }

  const [lastRun, hashtags, intervalMinutes] = await Promise.all([
    getSetting<string | null>(env.DB, "instagram_scanner_last_run", null),
    getSetting<string[]>(env.DB, "instagram_scanner_hashtags", DEFAULT_HASHTAGS),
    getSetting<number>(env.DB, "instagram_scanner_interval_minutes", DEFAULT_INTERVAL_MINUTES),
  ]);

  if (!options.force && lastRun && !isDue(lastRun, intervalMinutes)) {
    return {
      skipped: true,
      configured: true,
      hashtags_checked: 0,
      posts_seen: 0,
      posts_saved: 0,
      ran_at: ranAt,
      message: "Ainda não chegou o horário da próxima varredura.",
    };
  }

  const candidates = new Map<string, MetaMedia & { source_hashtag: string }>();
  let hashtagsChecked = 0;

  for (const hashtag of hashtags.slice(0, 8)) {
    try {
      const hashtagId = await findHashtagId(env, hashtag);
      if (!hashtagId) continue;
      hashtagsChecked++;
      const media = await fetchTopMedia(env, hashtagId);
      for (const item of media) {
        if (!item.id || (!item.media_url && !item.thumbnail_url)) continue;
        if (!candidates.has(item.id)) candidates.set(item.id, { ...item, source_hashtag: hashtag });
      }
    } catch {
      // Um hashtag pode falhar por permissão/limite; os demais continuam.
    }
  }

  const uniqueUsernames = [...new Set(
    [...candidates.values()].map((item) => sanitizeUsername(item.username || "")).filter(Boolean)
  )].slice(0, 20);
  const followers = new Map<string, number>();
  for (const username of uniqueUsernames) {
    try {
      const count = await fetchFollowers(env, username);
      if (count > 0) followers.set(username, count);
    } catch {
      // Métrica opcional; o ranking continua com likes/comentários.
    }
  }

  let postsSaved = 0;
  for (const item of candidates.values()) {
    const username = sanitizeUsername(item.username || "") || null;
    const followersCount = username ? followers.get(username) || 0 : 0;
    const likeCount = Number(item.like_count || 0);
    const commentsCount = Number(item.comments_count || 0);
    const engagementRate = followersCount > 0
      ? ((likeCount + commentsCount * 3) / followersCount) * 100
      : 0;
    const score = calculateScore({
      likeCount,
      commentsCount,
      followersCount,
      engagementRate,
      timestamp: item.timestamp || null,
    });

    const existing = await dbFirst<{ id: string }>(
      env.DB,
      "SELECT id FROM instagram_inspirations WHERE external_media_id = ?",
      item.id
    );
    const id = existing?.id || newId();
    await dbRun(
      env.DB,
      `INSERT INTO instagram_inspirations (
        id, external_media_id, username, media_type, caption, media_url, thumbnail_url, permalink,
        like_count, comments_count, followers_count, engagement_rate, score, source_hashtag,
        status, published_at, detected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED', ?, ?, ?)
      ON CONFLICT(external_media_id) DO UPDATE SET
        username = excluded.username,
        media_type = excluded.media_type,
        caption = excluded.caption,
        media_url = excluded.media_url,
        thumbnail_url = excluded.thumbnail_url,
        permalink = excluded.permalink,
        like_count = excluded.like_count,
        comments_count = excluded.comments_count,
        followers_count = excluded.followers_count,
        engagement_rate = excluded.engagement_rate,
        score = excluded.score,
        source_hashtag = excluded.source_hashtag,
        published_at = excluded.published_at,
        updated_at = excluded.updated_at`,
      id,
      item.id,
      username,
      item.media_type || null,
      item.caption || null,
      item.media_url || null,
      item.thumbnail_url || null,
      item.permalink || null,
      likeCount,
      commentsCount,
      followersCount,
      engagementRate,
      score,
      item.source_hashtag,
      item.timestamp || null,
      ranAt,
      ranAt
    );
    postsSaved++;
  }

  const result: InstagramScanResult = {
    skipped: false,
    configured: true,
    hashtags_checked: hashtagsChecked,
    posts_seen: candidates.size,
    posts_saved: postsSaved,
    ran_at: ranAt,
  };
  await Promise.all([
    setSetting(env.DB, "instagram_scanner_last_run", ranAt),
    setSetting(env.DB, "instagram_scanner_last_result", result),
  ]);
  return result;
}

export async function getInspiration(env: Bindings, id: string) {
  await ensureInstagramSchema(env);
  return dbFirst<InstagramInspiration>(env.DB, "SELECT * FROM instagram_inspirations WHERE id = ?", id);
}

export async function selectInspiration(env: Bindings, id: string) {
  const row = await getInspiration(env, id);
  if (!row) return null;
  await dbRun(env.DB, "UPDATE instagram_inspirations SET status = 'SELECTED', updated_at = ? WHERE id = ?", nowIso(), id);
  const caption = (row.caption || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const concept = [
    "Crie uma nova postagem original da Yasmin inspirada apenas na linguagem visual da referência selecionada.",
    "Use a referência para composição, enquadramento, pose geral, iluminação, clima, paleta e estilo de roupa.",
    "Não copie o rosto, a identidade, marcas, texto, logotipos nem detalhes exclusivos da pessoa da referência.",
    "A identidade facial, corporal e o cabelo devem vir exclusivamente das referências visuais cadastradas da Yasmin.",
    caption ? `Contexto da postagem de referência: ${caption}` : "",
  ].filter(Boolean).join(" ");
  return { ...row, status: "SELECTED", concept };
}

export async function saveInspirationAiReady(env: Bindings, id: string, file: File) {
  const row = await getInspiration(env, id);
  if (!row) return null;
  if (!file.type.startsWith("image/")) throw new Error("Arquivo AI-ready precisa ser uma imagem.");
  if (file.size > 2_000_000) throw new Error("Imagem AI-ready acima de 2 MB.");
  const key = `ai-ready/inspirations/${id}.jpg`;
  await env.ASSETS_BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
  await dbRun(env.DB, "UPDATE instagram_inspirations SET ai_ready_key = ?, updated_at = ? WHERE id = ?", key, nowIso(), id);
  return { key };
}

export async function getInspirationImageResponse(env: Bindings, id: string): Promise<Response | null> {
  const row = await getInspiration(env, id);
  if (!row) return null;
  if (row.ai_ready_key) {
    const object = await env.ASSETS_BUCKET.get(row.ai_ready_key);
    if (object) return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=300" } });
  }
  const sourceUrl = row.thumbnail_url || row.media_url;
  if (!sourceUrl) return null;
  const response = await fetch(sourceUrl, { headers: { "User-Agent": "YasminAIStudio/1.0" } });
  if (!response.ok || !response.body) return null;
  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=120",
    },
  });
}

export async function loadInspirationReference(env: Bindings, id: string) {
  const row = await getInspiration(env, id);
  if (!row?.ai_ready_key) return null;
  const object = await env.ASSETS_BUCKET.get(row.ai_ready_key);
  if (!object) return null;
  return {
    data: await object.arrayBuffer(),
    contentType: object.httpMetadata?.contentType || "image/jpeg",
    label: `Instagram @${row.username || "referência"}`,
  };
}

async function findHashtagId(env: Bindings, hashtag: string): Promise<string | null> {
  const result = await graphFetch<MetaHashtagSearch>(env, `/${env.META_IG_USER_ID}/ig_hashtag_search`, {
    user_id: env.META_IG_USER_ID || "",
    q: hashtag,
  });
  return result.data?.[0]?.id || null;
}

async function fetchTopMedia(env: Bindings, hashtagId: string): Promise<MetaMedia[]> {
  const richFields = "id,username,caption,comments_count,like_count,media_type,media_url,thumbnail_url,permalink,timestamp";
  try {
    const rich = await graphFetch<MetaList<MetaMedia>>(env, `/${hashtagId}/top_media`, {
      user_id: env.META_IG_USER_ID || "",
      fields: richFields,
      limit: "20",
    });
    return rich.data || [];
  } catch {
    const basic = await graphFetch<MetaList<MetaMedia>>(env, `/${hashtagId}/top_media`, {
      user_id: env.META_IG_USER_ID || "",
      fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
      limit: "20",
    });
    return basic.data || [];
  }
}

async function fetchFollowers(env: Bindings, username: string): Promise<number> {
  const fields = `business_discovery.username(${username}){username,followers_count,media_count}`;
  const result = await graphFetch<MetaBusinessDiscovery>(env, `/${env.META_IG_USER_ID}`, { fields });
  return Number(result.business_discovery?.followers_count || 0);
}

async function graphFetch<T>(env: Bindings, path: string, params: Record<string, string>): Promise<T> {
  if (!env.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN ausente");
  const version = env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
  const url = new URL(`https://graph.facebook.com/${version}${path}`);
  for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const payload = await response.json() as T & { error?: { message?: string; code?: number } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `Meta API HTTP ${response.status}`);
  return payload as T;
}

function calculateScore(input: { likeCount: number; commentsCount: number; followersCount: number; engagementRate: number; timestamp: string | null }) {
  const interactions = input.likeCount + input.commentsCount * 4;
  const ageHours = input.timestamp ? Math.max(0, (Date.now() - new Date(input.timestamp).getTime()) / 3_600_000) : 72;
  const freshness = ageHours <= 24 ? 18 : ageHours <= 48 ? 12 : ageHours <= 96 ? 7 : 2;
  let score: number;
  if (input.followersCount > 0) {
    score = 45 + Math.min(37, input.engagementRate * 7.5) + freshness;
  } else {
    score = 45 + Math.min(35, Math.log10(interactions + 1) * 8) + freshness;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeHashtag(value: string) {
  return String(value || "").trim().replace(/^#/, "").toLowerCase().replace(/[^a-z0-9_áàâãéêíóôõúç]/gi, "").slice(0, 80);
}

function sanitizeUsername(value: string) {
  const username = String(value || "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(username) ? username : "";
}

function isDue(lastRun: string, intervalMinutes: number) {
  const last = new Date(lastRun).getTime();
  if (!Number.isFinite(last)) return true;
  return Date.now() - last >= Math.max(60, Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES) * 60_000;
}
