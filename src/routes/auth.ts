import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fail, ok, newId, nowIso } from "../lib/response";
import { signAdminToken, verifyPassword } from "../lib/auth";
import { dbRun } from "../lib/db";

export const authRoute = new Hono<AppEnv>();

authRoute.post("/login", async (c) => {
  if (!c.env.ADMIN_PASSWORD_HASH || !c.env.JWT_SECRET) {
    return fail("Login ainda não configurado. Defina ADMIN_PASSWORD_HASH e JWT_SECRET.", 503);
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({}));
  if (!body.password) return fail("password é obrigatório");

  const valid = await verifyPassword(body.password, c.env.ADMIN_PASSWORD_HASH);
  if (!valid) {
    await dbRun(
      c.env.DB,
      `INSERT INTO activity_logs (id, event_type, description, created_at) VALUES (?, 'LOGIN_FAILED', ?, ?)`,
      newId(),
      "Tentativa de login administrativo inválida",
      nowIso()
    );
    return fail("Senha inválida.", 401);
  }

  const token = await signAdminToken(c.env.JWT_SECRET);
  await dbRun(
    c.env.DB,
    `INSERT INTO activity_logs (id, event_type, description, created_at) VALUES (?, 'LOGIN', ?, ?)`,
    newId(),
    "Login administrativo realizado",
    nowIso()
  );

  return ok({ token, token_type: "Bearer", expires_in: 43200 });
});
