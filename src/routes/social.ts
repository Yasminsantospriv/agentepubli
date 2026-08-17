import { Hono } from "hono";
import type { AppEnv } from "../types";
import { dbFirst, dbRun } from "../lib/db";
import { fail, notFound, ok, newId, nowIso } from "../lib/response";
import { generateCaptionWithAi } from "../lib/text-ai";
import { rateLimit } from "../lib/rate-limit";

export const socialRoute = new Hono<AppEnv>();

socialRoute.post(
  "/:slug/caption",
  rateLimit({ namespace: "caption", limit: 20, windowSeconds: 60 }),
  async (c) => {
    const slug = c.req.param("slug");
    const model = await dbFirst<{ id: string; name: string }>(
      c.env.DB,
      "SELECT id, name FROM models WHERE slug = ? AND active = 1",
      slug
    );
    if (!model) return notFound("Modelo");

    const body = await c.req.json<{
      context?: string;
      platform?: string;
      tone?: string;
      language?: string;
      content_id?: string;
    }>();
    if (!body.context) return fail("context é obrigatório");

    const result = await generateCaptionWithAi(c.env, {
      platform: body.platform || "instagram",
      context: body.context,
      tone: body.tone,
      language: body.language,
    });

    if (body.content_id) {
      const content = await dbFirst<{ id: string; model_id: string }>(
        c.env.DB,
        "SELECT id, model_id FROM content_library WHERE id = ?",
        body.content_id
      );
      if (!content || content.model_id !== model.id) return notFound("Conteúdo");

      await dbRun(
        c.env.DB,
        "UPDATE content_library SET caption = ?, hashtags = ?, updated_at = ? WHERE id = ?",
        result.caption,
        JSON.stringify(result.hashtags),
        nowIso(),
        content.id
      );
    }

    await dbRun(
      c.env.DB,
      `INSERT INTO activity_logs (id, model_id, event_type, description, metadata, created_at)
       VALUES (?, ?, 'CAPTION_GENERATED', ?, ?, ?)`,
      newId(),
      model.id,
      `Legenda gerada para ${body.platform || "instagram"}`,
      JSON.stringify({ model: result.model, content_id: body.content_id ?? null }),
      nowIso()
    );

    return ok(result);
  }
);
