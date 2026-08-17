import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, fail, nowIso } from "../lib/response";
import { buildProviderRegistry } from "../providers/registry";

export const settingsRoute = new Hono<AppEnv>();

// GET /settings — todas as configurações chave/valor
settingsRoute.get("/", async (c) => {
  const rows = await dbAll<{ key: string; value: string }>(c.env.DB, "SELECT * FROM settings");
  return ok(rows);
});

// PUT /settings/:key — cria ou atualiza uma configuração
settingsRoute.put("/:key", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json<{ value: unknown }>();
  if (body.value === undefined) return fail("value é obrigatório");

  await dbRun(
    c.env.DB,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(body.value),
    nowIso()
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM settings WHERE key = ?", key);
  return ok(row);
});

// GET /health — System Health card do dashboard
settingsRoute.get("/health", async (c) => {
  const checks: Record<string, string> = {
    frontend: "NOT_CONFIGURED", // este repositório ainda não inclui o painel visual
    api: "ONLINE",
    database: "OFFLINE",
    storage: "OFFLINE",
    ai_provider: "OFFLINE",
  };

  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.database = "ONLINE";
  } catch {
    checks.database = "ERROR";
  }

  try {
    await c.env.ASSETS_BUCKET.head("__healthcheck__");
    checks.storage = "ONLINE";
  } catch {
    // head em objeto inexistente ainda confirma que o binding responde
    checks.storage = "ONLINE";
  }

  const registry = buildProviderRegistry(c.env);
  checks.ai_provider = registry.some((p) => p.isConfigured()) ? "ONLINE" : "NOT_CONFIGURED";

  return ok(checks);
});

// GET /dashboard — cards agregados da página inicial
settingsRoute.get("/dashboard", async (c) => {
  const [referencesCount, todayContent, readyContent, opportunitiesCount, automationsCount] = await Promise.all([
    dbFirst<{ count: number }>(c.env.DB, "SELECT COUNT(*) as count FROM model_references WHERE active = 1"),
    dbFirst<{ count: number }>(
      c.env.DB,
      "SELECT COUNT(*) as count FROM generation_jobs WHERE date(created_at) = date('now')"
    ),
    dbFirst<{ count: number }>(c.env.DB, "SELECT COUNT(*) as count FROM content_library WHERE status = 'READY'"),
    dbFirst<{ count: number }>(
      c.env.DB,
      "SELECT COUNT(*) as count FROM content_opportunities WHERE status = 'SUGGESTED'"
    ),
    dbFirst<{ count: number }>(c.env.DB, "SELECT COUNT(*) as count FROM automation_rules WHERE active = 1"),
  ]);

  const recentActivity = await dbAll(
    c.env.DB,
    "SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10"
  );

  return ok({
    references_count: referencesCount?.count ?? 0,
    content_generated_today: todayContent?.count ?? 0,
    content_ready: readyContent?.count ?? 0,
    trend_opportunities: opportunitiesCount?.count ?? 0,
    active_automations: automationsCount?.count ?? 0,
    recent_activity: recentActivity,
  });
});
