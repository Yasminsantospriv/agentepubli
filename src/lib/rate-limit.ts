import type { Context, Next } from "hono";
import type { AppEnv } from "../types";
import { fail } from "./response";

type RateLimitOptions = {
  namespace: string;
  limit: number;
  windowSeconds: number;
};

export function rateLimit(options: RateLimitOptions) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.env.CACHE) return next();

    const authUser = c.get("authUser");
    const identity = authUser?.sub || c.req.header("CF-Connecting-IP") || "anonymous";
    const bucket = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const key = `rl:${options.namespace}:${identity}:${bucket}`;

    const current = Number((await c.env.CACHE.get(key)) ?? "0");
    if (current >= options.limit) {
      return fail(`Limite temporário excedido. Tente novamente em até ${options.windowSeconds} segundos.`, 429);
    }

    await c.env.CACHE.put(key, String(current + 1), { expirationTtl: options.windowSeconds + 5 });
    c.header("X-RateLimit-Limit", String(options.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, options.limit - current - 1)));
    await next();
  };
}
