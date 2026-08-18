import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";
import { getTrendScannerStatus, runTrendScanner } from "../services/trend-scanner";

export const trendsRoute = new Hono<AppEnv>();

// GET /trends?platform=instagram&min_score=70 — lista tendências ativas
trendsRoute.get("/trends", async (c) => {
  const platform = c.req.query("platform");
  const minScore = c.req.query("min_score");

  let sql = "SELECT * FROM social_trends WHERE (expires_at IS NULL OR expires_at > ?)";
  const params: unknown[] = [nowIso()];

  if (platform) {
    sql += " AND platform = ?";
    params.push(platform);
  }
  if (minScore) {
    sql += " AND score >= ?";
    params.push(Number(minScore));
  }
  sql += " ORDER BY score DESC, detected_at DESC LIMIT 50";

  const rows = await dbAll(c.env.DB, sql, ...params);
  return ok(rows);
});

// GET /trends/scanner — estado do scanner automático
trendsRoute.get("/trends/scanner", async (c) => {
  return ok(await getTrendScannerStatus(c.env));
});

// POST /trends/scan — força uma busca imediata
trendsRoute.post("/trends/scan", async (c) => {
  const result = await runTrendScanner(c.env, { force: true });
  return ok(result);
});

// POST /trends — registra uma tendência manualmente
trendsRoute.post("/trends", async (c) => {
  const body = await c.req.json<{
    platform: string;
    title: string;
    category?: string;
    score?: number;
    source?: string;
    expires_at?: string;
  }>();

  if (!body.platform || !body.title) return fail("platform e title são obrigatórios");

  const id = newId();
  await dbRun(
    c.env.DB,
    `INSERT INTO social_trends (id, platform, title, category, score, source, detected_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.platform,
    body.title,
    body.category ?? null,
    body.score ?? 0,
    body.source ?? null,
    nowIso(),
    body.expires_at ?? null
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM social_trends WHERE id = ?", id);
  return created(row);
});

// GET /models/:slug/opportunities — oportunidades de conteúdo sugeridas para o modelo
trendsRoute.get("/models/:slug/opportunities", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const rows = await dbAll(
    c.env.DB,
    `SELECT co.*, st.title AS trend_title, st.platform, st.score, st.source, st.category
     FROM content_opportunities co JOIN social_trends st ON st.id = co.trend_id
     WHERE co.model_id = ? ORDER BY co.compatibility_score DESC, co.created_at DESC LIMIT 50`,
    model.id
  );
  return ok(rows);
});

// POST /models/:slug/opportunities — cria manualmente uma oportunidade a partir de uma tendência
trendsRoute.post("/models/:slug/opportunities", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const body = await c.req.json<{
    trend_id: string;
    compatibility_score?: number;
    suggested_concept?: string;
  }>();

  const trend = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM social_trends WHERE id = ?", body.trend_id);
  if (!trend) return notFound("Tendência");

  const existing = await dbFirst<{ id: string }>(
    c.env.DB,
    "SELECT id FROM content_opportunities WHERE trend_id = ? AND model_id = ? LIMIT 1",
    body.trend_id,
    model.id
  );
  if (existing) return ok(existing);

  const id = newId();
  await dbRun(
    c.env.DB,
    `INSERT INTO content_opportunities (id, trend_id, model_id, compatibility_score, suggested_concept, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'SUGGESTED', ?)`,
    id,
    body.trend_id,
    model.id,
    body.compatibility_score ?? null,
    body.suggested_concept ?? null,
    nowIso()
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM content_opportunities WHERE id = ?", id);
  return created(row);
});
