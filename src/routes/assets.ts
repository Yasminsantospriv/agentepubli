import { Hono } from "hono";
import type { AppEnv } from "../types";

export const assetsRoute = new Hono<AppEnv>();

// GET /assets/*  — faz streaming de um objeto do R2 (imagens de referência e geradas)
// Alternativa a expor o bucket publicamente: mantém controle de acesso no Worker.
assetsRoute.get("/*", async (c) => {
  const key = c.req.path.replace(/^\/assets\//, "");
  if (!key) return c.notFound();

  const object = await c.env.ASSETS_BUCKET.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  return new Response(object.body, { headers });
});
