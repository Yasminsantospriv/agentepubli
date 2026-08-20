import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fail, notFound, ok } from "../lib/response";
import {
  getInstagramStatus,
  getInspiration,
  getInspirationImageResponse,
  listInstagramInspirations,
  runInstagramScanner,
  saveInspirationAiReady,
  saveInstagramConfig,
  selectInspiration,
} from "../services/instagram-inspiration";

export const instagramRoute = new Hono<AppEnv>();

instagramRoute.get("/instagram/status", async (c) => {
  return ok(await getInstagramStatus(c.env));
});

instagramRoute.get("/instagram/inspirations", async (c) => {
  const limit = Number(c.req.query("limit") || 40);
  return ok(await listInstagramInspirations(c.env, limit));
});

instagramRoute.post("/instagram/scan", async (c) => {
  return ok(await runInstagramScanner(c.env, { force: true }));
});

instagramRoute.put("/instagram/config", async (c) => {
  const body = await c.req.json<{ hashtags?: string[]; interval_minutes?: number }>().catch(() => ({}));
  return ok(await saveInstagramConfig(c.env, body));
});

instagramRoute.get("/instagram/inspirations/:id", async (c) => {
  const row = await getInspiration(c.env, c.req.param("id"));
  if (!row) return notFound("Inspiração");
  return ok(row);
});

instagramRoute.get("/instagram/inspirations/:id/image", async (c) => {
  const response = await getInspirationImageResponse(c.env, c.req.param("id"));
  if (!response) return fail("Imagem da inspiração indisponível", 404);
  return response;
});

instagramRoute.post("/instagram/inspirations/:id/ai-ready", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Campo file é obrigatório");
  try {
    const saved = await saveInspirationAiReady(c.env, c.req.param("id"), file);
    if (!saved) return notFound("Inspiração");
    return ok(saved);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
});

instagramRoute.post("/instagram/inspirations/:id/select", async (c) => {
  const selected = await selectInspiration(c.env, c.req.param("id"));
  if (!selected) return notFound("Inspiração");
  return ok(selected);
});
