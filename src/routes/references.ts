import { Hono } from "hono";
import type { AppEnv, ReferenceType } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";
import { buildReferenceKey, extFromMime, uploadToR2, validateUpload, StorageValidationError } from "../lib/storage";

export const referencesRoute = new Hono<AppEnv>();

const VALID_TYPES: ReferenceType[] = ["FACE", "BODY", "HAIR", "MASTER", "STYLE", "TEMPORARY"];

// GET /models/:slug/references?type=FACE&active=true — lista referências do modelo
referencesRoute.get("/:slug/references", async (c) => {
  const slug = c.req.param("slug");
  const type = c.req.query("type");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  let sql = "SELECT * FROM model_references WHERE model_id = ? AND active = 1";
  const params: unknown[] = [model.id];
  if (type) {
    sql += " AND reference_type = ?";
    params.push(type);
  }
  sql += " ORDER BY priority DESC, created_at DESC";

  const rows = await dbAll(c.env.DB, sql, ...params);
  return ok(rows);
});

// POST /models/:slug/references — upload de uma nova referência (multipart/form-data)
// Campos: file (binário), reference_type, priority?, weight?, description?
referencesRoute.post("/:slug/references", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const form = await c.req.formData();
  const file = form.get("file");
  const referenceType = String(form.get("reference_type") ?? "");

  if (!(file instanceof File)) return fail("Campo 'file' é obrigatório");
  if (!VALID_TYPES.includes(referenceType as ReferenceType)) {
    return fail(`reference_type inválido. Use um de: ${VALID_TYPES.join(", ")}`);
  }

  try {
    validateUpload({ size: file.size, type: file.type });
  } catch (err) {
    if (err instanceof StorageValidationError) return fail(err.message);
    throw err;
  }

  const id = newId();
  const ext = extFromMime(file.type);
  const key = buildReferenceKey(slug, referenceType, id, ext);
  await uploadToR2(c.env.ASSETS_BUCKET, key, await file.arrayBuffer(), file.type);

  const now = nowIso();
  const priority = Number(form.get("priority") ?? 5);
  const weight = Number(form.get("weight") ?? 1.0);
  const description = form.get("description") ? String(form.get("description")) : null;

  await dbRun(
    c.env.DB,
    `INSERT INTO model_references (
      id, model_id, storage_key, reference_type, priority, weight,
      is_master_face, is_master_body, is_master_full, active, description,
      source_type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, 'UPLOAD', ?)`,
    id,
    model.id,
    key,
    referenceType,
    priority,
    weight,
    description,
    now
  );

  await logActivity(c.env.DB, model.id, "REFERENCE_UPLOAD", `Referência ${referenceType} adicionada`);

  const row = await dbFirst(c.env.DB, "SELECT * FROM model_references WHERE id = ?", id);
  return created(row);
});

// PATCH /references/:id — atualiza prioridade/peso/flags de master/ativo
referencesRoute.patch("/references/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM model_references WHERE id = ?", id);
  if (!existing) return notFound("Referência");

  const body = await c.req.json<Record<string, unknown>>();
  const fields: string[] = [];
  const params: unknown[] = [];

  for (const [key, column] of [
    ["priority", "priority"],
    ["weight", "weight"],
    ["active", "active"],
    ["description", "description"],
    ["is_master_face", "is_master_face"],
    ["is_master_body", "is_master_body"],
    ["is_master_full", "is_master_full"],
  ] as const) {
    if (key in body) {
      fields.push(`${column} = ?`);
      params.push(body[key]);
    }
  }

  if (fields.length === 0) return fail("Nenhum campo válido para atualizar");

  params.push(id);
  await dbRun(c.env.DB, `UPDATE model_references SET ${fields.join(", ")} WHERE id = ?`, ...params);

  const row = await dbFirst(c.env.DB, "SELECT * FROM model_references WHERE id = ?", id);
  return ok(row);
});

// DELETE /references/:id
referencesRoute.delete("/references/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string; model_id: string; storage_key: string }>(
    c.env.DB,
    "SELECT id, model_id, storage_key FROM model_references WHERE id = ?",
    id
  );
  if (!existing) return notFound("Referência");

  await c.env.ASSETS_BUCKET.delete(existing.storage_key);
  await dbRun(c.env.DB, "DELETE FROM model_references WHERE id = ?", id);
  await logActivity(c.env.DB, existing.model_id, "REFERENCE_DELETE", `Referência ${id} removida`);

  return ok({ deleted: true });
});

async function logActivity(db: D1Database, modelId: string, eventType: string, description: string) {
  await dbRun(
    db,
    `INSERT INTO activity_logs (id, model_id, event_type, description, created_at) VALUES (?, ?, ?, ?, ?)`,
    newId(),
    modelId,
    eventType,
    description,
    nowIso()
  );
}
