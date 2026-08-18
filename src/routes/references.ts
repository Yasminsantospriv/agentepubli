import { Hono } from "hono";
import type { AppEnv, ReferenceType } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";
import { buildReferenceKey, extFromMime, uploadToR2, validateUpload, StorageValidationError } from "../lib/storage";

export const referencesRoute = new Hono<AppEnv>();

const VALID_TYPES: ReferenceType[] = ["FACE", "BODY", "HAIR", "MASTER", "STYLE", "TEMPORARY"];

referencesRoute.get("/:slug/references", async (c) => {
  const slug = c.req.param("slug");
  const type = c.req.query("type");
  const active = c.req.query("active");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  let sql = "SELECT * FROM model_references WHERE model_id = ?";
  const params: unknown[] = [model.id];
  if (active !== "all") {
    sql += " AND active = ?";
    params.push(active === "false" ? 0 : 1);
  }
  if (type) {
    sql += " AND reference_type = ?";
    params.push(type);
  }
  sql += " ORDER BY is_master_face DESC, is_master_body DESC, is_master_full DESC, priority DESC, created_at DESC";
  return ok(await dbAll(c.env.DB, sql, ...params));
});

referencesRoute.post("/:slug/references", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const form = await c.req.formData();
  const file = form.get("file");
  const referenceType = String(form.get("reference_type") ?? "").toUpperCase();
  if (!(file instanceof File)) return fail("Campo 'file' é obrigatório");
  if (!VALID_TYPES.includes(referenceType as ReferenceType)) return fail(`Tipo inválido. Use: ${VALID_TYPES.join(", ")}`);

  try { validateUpload({ size: file.size, type: file.type }); }
  catch (err) { if (err instanceof StorageValidationError) return fail(err.message); throw err; }

  const id = newId();
  const key = buildReferenceKey(slug, referenceType, id, extFromMime(file.type));
  await uploadToR2(c.env.ASSETS_BUCKET, key, await file.arrayBuffer(), file.type);

  const priority = Math.max(0, Math.min(100, Number(form.get("priority") ?? 5)));
  const weight = Math.max(0, Math.min(5, Number(form.get("weight") ?? 1)));
  const description = form.get("description") ? String(form.get("description")) : null;
  const masterKind = String(form.get("master_kind") ?? "").toUpperCase();
  const isMasterFace = masterKind === "FACE" ? 1 : 0;
  const isMasterBody = masterKind === "BODY" ? 1 : 0;
  const isMasterFull = masterKind === "FULL" ? 1 : 0;

  if (isMasterFace) await dbRun(c.env.DB, "UPDATE model_references SET is_master_face = 0 WHERE model_id = ?", model.id);
  if (isMasterBody) await dbRun(c.env.DB, "UPDATE model_references SET is_master_body = 0 WHERE model_id = ?", model.id);
  if (isMasterFull) await dbRun(c.env.DB, "UPDATE model_references SET is_master_full = 0 WHERE model_id = ?", model.id);

  await dbRun(c.env.DB, `INSERT INTO model_references (
    id, model_id, storage_key, reference_type, priority, weight,
    is_master_face, is_master_body, is_master_full, active, description, source_type, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'UPLOAD', ?)`,
  id, model.id, key, referenceType, priority, weight, isMasterFace, isMasterBody, isMasterFull, description, nowIso());

  await logActivity(c.env.DB, model.id, "REFERENCE_UPLOAD", `Referência ${referenceType} adicionada`);
  return created(await dbFirst(c.env.DB, "SELECT * FROM model_references WHERE id = ?", id));
});

referencesRoute.patch("/references/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string; model_id: string }>(c.env.DB, "SELECT id, model_id FROM model_references WHERE id = ?", id);
  if (!existing) return notFound("Referência");
  const body = await c.req.json<Record<string, unknown>>();

  if (body.reference_type && !VALID_TYPES.includes(String(body.reference_type).toUpperCase() as ReferenceType)) return fail("Tipo de referência inválido");
  if (Number(body.is_master_face) === 1) await dbRun(c.env.DB, "UPDATE model_references SET is_master_face = 0 WHERE model_id = ?", existing.model_id);
  if (Number(body.is_master_body) === 1) await dbRun(c.env.DB, "UPDATE model_references SET is_master_body = 0 WHERE model_id = ?", existing.model_id);
  if (Number(body.is_master_full) === 1) await dbRun(c.env.DB, "UPDATE model_references SET is_master_full = 0 WHERE model_id = ?", existing.model_id);

  const fields: string[] = [];
  const params: unknown[] = [];
  const allowed = [
    ["reference_type", "reference_type"], ["priority", "priority"], ["weight", "weight"], ["active", "active"],
    ["description", "description"], ["is_master_face", "is_master_face"], ["is_master_body", "is_master_body"], ["is_master_full", "is_master_full"],
  ] as const;
  for (const [key, column] of allowed) if (key in body) {
    fields.push(`${column} = ?`);
    let value = body[key];
    if (key === "reference_type") value = String(value).toUpperCase();
    if (key === "priority") value = Math.max(0, Math.min(100, Number(value)));
    if (key === "weight") value = Math.max(0, Math.min(5, Number(value)));
    params.push(value);
  }
  if (!fields.length) return fail("Nenhum campo válido para atualizar");
  params.push(id);
  await dbRun(c.env.DB, `UPDATE model_references SET ${fields.join(", ")} WHERE id = ?`, ...params);
  return ok(await dbFirst(c.env.DB, "SELECT * FROM model_references WHERE id = ?", id));
});

referencesRoute.delete("/references/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string; model_id: string; storage_key: string }>(c.env.DB, "SELECT id, model_id, storage_key FROM model_references WHERE id = ?", id);
  if (!existing) return notFound("Referência");
  await c.env.ASSETS_BUCKET.delete(existing.storage_key);
  await dbRun(c.env.DB, "DELETE FROM model_references WHERE id = ?", id);
  await logActivity(c.env.DB, existing.model_id, "REFERENCE_DELETE", `Referência ${id} removida`);
  return ok({ deleted: true });
});

async function logActivity(db: D1Database, modelId: string, eventType: string, description: string) {
  await dbRun(db, `INSERT INTO activity_logs (id, model_id, event_type, description, created_at) VALUES (?, ?, ?, ?, ?)`, newId(), modelId, eventType, description, nowIso());
}
