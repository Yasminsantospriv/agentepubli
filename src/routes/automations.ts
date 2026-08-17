import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";
import { runAutomationRules } from "../services/automation-runner";

export const automationsRoute = new Hono<AppEnv>();

// GET /automations — lista todas as regras de automação
automationsRoute.get("/", async (c) => {
  const rows = await dbAll(c.env.DB, "SELECT * FROM automation_rules ORDER BY created_at DESC");
  return ok(rows);
});


// POST /automations/run — executa manualmente as regras (útil para teste/admin)
automationsRoute.post("/run", async (c) => {
  const result = await runAutomationRules(c.env);
  return ok(result);
});

// POST /automations — cria uma nova regra
// Exemplo de body:
// { "name": "Sugerir conteúdo em tendência alta", "trigger_type": "trend_score_above",
//   "trigger_config": { "threshold": 85 }, "action_type": "suggest_content", "action_config": {} }
automationsRoute.post("/", async (c) => {
  const body = await c.req.json<{
    model_slug?: string;
    name: string;
    trigger_type: string;
    trigger_config?: Record<string, unknown>;
    action_type: string;
    action_config?: Record<string, unknown>;
  }>();

  if (!body.name || !body.trigger_type || !body.action_type) {
    return fail("name, trigger_type e action_type são obrigatórios");
  }

  let modelId: string | null = null;
  if (body.model_slug) {
    const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", body.model_slug);
    if (!model) return notFound("Modelo");
    modelId = model.id;
  }

  const id = newId();
  const now = nowIso();
  await dbRun(
    c.env.DB,
    `INSERT INTO automation_rules (id, model_id, name, trigger_type, trigger_config, action_type, action_config, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    modelId,
    body.name,
    body.trigger_type,
    JSON.stringify(body.trigger_config ?? {}),
    body.action_type,
    JSON.stringify(body.action_config ?? {}),
    now,
    now
  );

  await dbRun(
    c.env.DB,
    `INSERT INTO activity_logs (id, model_id, event_type, description, created_at) VALUES (?, ?, 'SETTING_CHANGED', ?, ?)`,
    newId(),
    modelId,
    `Automação criada: ${body.name}`,
    now
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM automation_rules WHERE id = ?", id);
  return created(row);
});

// PATCH /automations/:id — ativa/desativa ou edita uma regra
automationsRoute.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM automation_rules WHERE id = ?", id);
  if (!existing) return notFound("Automação");

  const body = await c.req.json<{ active?: boolean; name?: string }>();
  const fields: string[] = [];
  const params: unknown[] = [];

  if (body.active !== undefined) {
    fields.push("active = ?");
    params.push(body.active ? 1 : 0);
  }
  if (body.name) {
    fields.push("name = ?");
    params.push(body.name);
  }
  if (fields.length === 0) return fail("Nenhum campo válido para atualizar");

  fields.push("updated_at = ?");
  params.push(nowIso(), id);

  await dbRun(c.env.DB, `UPDATE automation_rules SET ${fields.join(", ")} WHERE id = ?`, ...params);
  const row = await dbFirst(c.env.DB, "SELECT * FROM automation_rules WHERE id = ?", id);
  return ok(row);
});

// DELETE /automations/:id
automationsRoute.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await dbRun(c.env.DB, "DELETE FROM automation_rules WHERE id = ?", id);
  return ok({ deleted: true });
});
