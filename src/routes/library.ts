import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";

export const libraryRoute = new Hono<AppEnv>();

// GET /library?model=yasmin&type=post&status=READY — biblioteca de conteúdo com filtros
libraryRoute.get("/library", async (c) => {
  const modelSlug = c.req.query("model");
  const type = c.req.query("type");
  const status = c.req.query("status");

  let sql = `SELECT cl.* FROM content_library cl JOIN models m ON m.id = cl.model_id WHERE 1=1`;
  const params: unknown[] = [];

  if (modelSlug) {
    sql += " AND m.slug = ?";
    params.push(modelSlug);
  }
  if (type) {
    sql += " AND cl.content_type = ?";
    params.push(type);
  }
  if (status) {
    sql += " AND cl.status = ?";
    params.push(status);
  }
  sql += " ORDER BY cl.created_at DESC LIMIT 100";

  const rows = await dbAll(c.env.DB, sql, ...params);
  return ok(rows);
});

// POST /library — cria um item de conteúdo a partir de um asset aprovado
libraryRoute.post("/library", async (c) => {
  const body = await c.req.json<{
    model_slug: string;
    asset_id?: string;
    content_type: string;
    caption?: string;
    hashtags?: string[];
  }>();

  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", body.model_slug);
  if (!model) return notFound("Modelo");

  const id = newId();
  const now = nowIso();
  await dbRun(
    c.env.DB,
    `INSERT INTO content_library (id, model_id, asset_id, content_type, caption, hashtags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
    id,
    model.id,
    body.asset_id ?? null,
    body.content_type,
    body.caption ?? null,
    JSON.stringify(body.hashtags ?? []),
    now,
    now
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM content_library WHERE id = ?", id);
  return created(row);
});

// PATCH /library/:id — atualiza legenda/hashtags/status
libraryRoute.patch("/library/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM content_library WHERE id = ?", id);
  if (!existing) return notFound("Conteúdo");

  const body = await c.req.json<Record<string, unknown>>();
  const fields: string[] = [];
  const params: unknown[] = [];

  if ("caption" in body) {
    fields.push("caption = ?");
    params.push(body.caption);
  }
  if ("hashtags" in body) {
    fields.push("hashtags = ?");
    params.push(JSON.stringify(body.hashtags));
  }
  if ("status" in body) {
    fields.push("status = ?");
    params.push(body.status);
  }
  if (fields.length === 0) return fail("Nenhum campo válido para atualizar");

  fields.push("updated_at = ?");
  params.push(nowIso(), id);

  await dbRun(c.env.DB, `UPDATE content_library SET ${fields.join(", ")} WHERE id = ?`, ...params);
  const row = await dbFirst(c.env.DB, "SELECT * FROM content_library WHERE id = ?", id);
  return ok(row);
});

// GET /planner?from=2026-08-01&to=2026-08-31 — visualização do calendário
libraryRoute.get("/planner", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");

  let sql = `SELECT cp.*, cl.content_type, cl.caption, cl.status AS content_status
             FROM content_plans cp JOIN content_library cl ON cl.id = cp.content_id
             WHERE 1=1`;
  const params: unknown[] = [];

  if (from) {
    sql += " AND cp.scheduled_at >= ?";
    params.push(from);
  }
  if (to) {
    sql += " AND cp.scheduled_at <= ?";
    params.push(to);
  }
  sql += " ORDER BY cp.scheduled_at ASC";

  const rows = await dbAll(c.env.DB, sql, ...params);
  return ok(rows);
});

// POST /planner — agenda um item de conteúdo
libraryRoute.post("/planner", async (c) => {
  const body = await c.req.json<{ content_id: string; platform: string; scheduled_at: string }>();

  const content = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM content_library WHERE id = ?", body.content_id);
  if (!content) return notFound("Conteúdo");

  const id = newId();
  await dbRun(
    c.env.DB,
    `INSERT INTO content_plans (id, content_id, platform, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, 'DRAFT', ?)`,
    id,
    body.content_id,
    body.platform,
    body.scheduled_at,
    nowIso()
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM content_plans WHERE id = ?", id);
  return created(row);
});
