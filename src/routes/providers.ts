import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, notFound, newId, nowIso } from "../lib/response";
import { buildProviderRegistry, getProvider } from "../providers/registry";

export const providersRoute = new Hono<AppEnv>();

// GET /providers — status ao vivo de todos os providers (configurado ou não)
providersRoute.get("/", async (c) => {
  const registry = buildProviderRegistry(c.env);

  const cards = await Promise.all(
    registry.map(async (provider) => {
      const configured = provider.isConfigured();
      const dbRow = await dbFirst<{ priority: number; active: number }>(
        c.env.DB,
        "SELECT priority, active FROM ai_providers WHERE slug = ?",
        provider.slug
      );

      return {
        slug: provider.slug,
        name: provider.name,
        api_key_configured: configured,
        status: configured ? "ONLINE" : "NOT_CONFIGURED",
        priority: dbRow?.priority ?? 5,
        active: dbRow ? !!dbRow.active : configured,
        models: await provider.getModels(),
      };
    })
  );

  return ok(cards);
});

// POST /providers/:slug/test — testa a conexão com um provider
providersRoute.post("/:slug/test", async (c) => {
  const slug = c.req.param("slug");
  const provider = getProvider(c.env, slug);
  if (!provider) return notFound("Provider");

  const result = await provider.testConnection();

  await dbRun(
    c.env.DB,
    `INSERT INTO ai_providers (id, name, slug, provider_type, api_key_configured, status, priority, active, last_tested_at, last_test_result, created_at, updated_at)
     VALUES (?, ?, ?, 'image_generation', ?, ?, 5, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       api_key_configured = excluded.api_key_configured,
       status = excluded.status,
       last_tested_at = excluded.last_tested_at,
       last_test_result = excluded.last_test_result,
       updated_at = excluded.updated_at`,
    newId(),
    provider.name,
    provider.slug,
    provider.isConfigured() ? 1 : 0,
    result.success ? "ONLINE" : "ERROR",
    provider.isConfigured() ? 1 : 0,
    nowIso(),
    JSON.stringify(result),
    nowIso(),
    nowIso()
  );

  return ok(result);
});

// PATCH /providers/:slug — atualiza prioridade / ativo/inativo
providersRoute.patch("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const provider = getProvider(c.env, slug);
  if (!provider) return notFound("Provider");

  const body = await c.req.json<{ priority?: number; active?: boolean }>();

  await dbRun(
    c.env.DB,
    `INSERT INTO ai_providers (id, name, slug, provider_type, api_key_configured, status, priority, active, created_at, updated_at)
     VALUES (?, ?, ?, 'image_generation', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET
       priority = COALESCE(?, priority),
       active = COALESCE(?, active),
       updated_at = ?`,
    newId(),
    provider.name,
    provider.slug,
    provider.isConfigured() ? 1 : 0,
    provider.isConfigured() ? "ONLINE" : "NOT_CONFIGURED",
    body.priority ?? 5,
    body.active === undefined ? (provider.isConfigured() ? 1 : 0) : body.active ? 1 : 0,
    nowIso(),
    nowIso(),
    body.priority ?? null,
    body.active === undefined ? null : body.active ? 1 : 0,
    nowIso()
  );

  const row = await dbFirst(c.env.DB, "SELECT * FROM ai_providers WHERE slug = ?", slug);
  return ok(row);
});
