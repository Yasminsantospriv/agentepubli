import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, notFound, newId, nowIso } from "../lib/response";

export const modelsRoute = new Hono<AppEnv>();

// GET /models — lista todos os modelos
modelsRoute.get("/", async (c) => {
  const rows = await dbAll(c.env.DB, "SELECT * FROM models ORDER BY created_at DESC");
  return ok(rows);
});

// POST /models — cria um novo modelo (ex: Yasmin)
modelsRoute.post("/", async (c) => {
  const body = await c.req.json<{ name: string; slug: string }>();
  if (!body.name || !body.slug) return notFound("name e slug são obrigatórios") as never;

  const id = newId();
  const now = nowIso();
  await dbRun(
    c.env.DB,
    `INSERT INTO models (id, name, slug, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
    id,
    body.name,
    body.slug,
    now,
    now
  );
  const row = await dbFirst(c.env.DB, "SELECT * FROM models WHERE id = ?", id);
  return created(row);
});

// GET /models/:slug — busca um modelo pelo slug (ex: 'yasmin')
modelsRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst(c.env.DB, "SELECT * FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");
  return ok(model);
});

// GET /models/:slug/identity — ficha de identidade visual completa
modelsRoute.get("/:slug/identity", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const identity = await dbFirst(c.env.DB, "SELECT * FROM model_identity WHERE model_id = ?", model.id);
  return ok(identity);
});

// PUT /models/:slug/identity — cria ou atualiza a ficha de identidade
modelsRoute.put("/:slug/identity", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const body = await c.req.json<Record<string, unknown>>();
  const existing = await dbFirst<{ id: string }>(
    c.env.DB,
    "SELECT id FROM model_identity WHERE model_id = ?",
    model.id
  );
  const now = nowIso();

  const negativeTraits = JSON.stringify(body.negative_traits ?? []);

  if (existing) {
    await dbRun(
      c.env.DB,
      `UPDATE model_identity SET
        age_range = ?, ethnicity_description = ?, skin_tone = ?, body_type = ?,
        face_description = ?, hair_description = ?, distinguishing_features = ?,
        negative_traits = ?, default_identity_lock = ?, updated_at = ?
       WHERE model_id = ?`,
      body.age_range ?? null,
      body.ethnicity_description ?? null,
      body.skin_tone ?? null,
      body.body_type ?? null,
      body.face_description ?? null,
      body.hair_description ?? null,
      body.distinguishing_features ?? null,
      negativeTraits,
      body.default_identity_lock ?? "NORMAL",
      now,
      model.id
    );
  } else {
    await dbRun(
      c.env.DB,
      `INSERT INTO model_identity (
        id, model_id, age_range, ethnicity_description, skin_tone, body_type,
        face_description, hair_description, distinguishing_features,
        negative_traits, default_identity_lock, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(),
      model.id,
      body.age_range ?? null,
      body.ethnicity_description ?? null,
      body.skin_tone ?? null,
      body.body_type ?? null,
      body.face_description ?? null,
      body.hair_description ?? null,
      body.distinguishing_features ?? null,
      negativeTraits,
      body.default_identity_lock ?? "NORMAL",
      now,
      now
    );
  }

  const identity = await dbFirst(c.env.DB, "SELECT * FROM model_identity WHERE model_id = ?", model.id);
  return ok(identity);
});
