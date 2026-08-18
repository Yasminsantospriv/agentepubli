import { Hono } from "hono";
import type { AppEnv } from "../types";
import { fail, ok, newId, nowIso } from "../lib/response";
import { hashPassword, signAdminToken, verifyPassword } from "../lib/auth";
import { dbRun } from "../lib/db";
import { getSetting, setSetting } from "../lib/app-settings";

export const authRoute = new Hono<AppEnv>();

async function getEffectivePasswordHash(c: Parameters<typeof authRoute.post>[1] extends never ? never : any) {
  return getSetting<string | null>(c.env.DB, "admin_password_hash", null).then((saved) => saved || c.env.ADMIN_PASSWORD_HASH || null);
}

authRoute.post("/login", async (c) => {
  if (!c.env.JWT_SECRET) {
    return fail("Login ainda não configurado. Defina JWT_SECRET.", 503);
  }

  const storedHash = await getSetting<string | null>(c.env.DB, "admin_password_hash", null);
  const effectiveHash = storedHash || c.env.ADMIN_PASSWORD_HASH;
  if (!effectiveHash) {
    return fail("Login ainda não configurado. Defina ADMIN_PASSWORD_HASH.", 503);
  }

  const body = await c.req.json<{ password?: string }>().catch(() => ({}));
  if (!body.password) return fail("password é obrigatório");

  const valid = await verifyPassword(body.password, effectiveHash);
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

authRoute.post("/change-password", async (c) => {
  const body = await c.req.json<{ current_password?: string; new_password?: string }>().catch(() => ({}));
  if (!body.current_password || !body.new_password) return fail("Senha atual e nova senha são obrigatórias.");
  if (body.new_password.length < 10) return fail("A nova senha deve ter pelo menos 10 caracteres.");

  const storedHash = await getSetting<string | null>(c.env.DB, "admin_password_hash", null);
  const effectiveHash = storedHash || c.env.ADMIN_PASSWORD_HASH;
  if (!effectiveHash) return fail("Senha administrativa não configurada.", 503);

  const currentValid = await verifyPassword(body.current_password, effectiveHash);
  if (!currentValid) return fail("Senha atual incorreta.", 401);

  const newHash = await hashPassword(body.new_password);
  await setSetting(c.env.DB, "admin_password_hash", newHash);

  await dbRun(
    c.env.DB,
    `INSERT INTO activity_logs (id, event_type, description, created_at) VALUES (?, 'PASSWORD_CHANGED', ?, ?)`,
    newId(),
    "Senha administrativa alterada pelo painel",
    nowIso()
  );

  return ok({ changed: true });
});
