import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Bindings } from "./types";
import { fail } from "./lib/response";
import { requireAuth } from "./lib/auth";
import { runAutomationRules } from "./services/automation-runner";

import { authRoute } from "./routes/auth";
import { modelsRoute } from "./routes/models";
import { referencesRoute } from "./routes/references";
import { providersRoute } from "./routes/providers";
import { generationRoute } from "./routes/generation";
import { socialRoute } from "./routes/social";
import { libraryRoute } from "./routes/library";
import { trendsRoute } from "./routes/trends";
import { automationsRoute } from "./routes/automations";
import { settingsRoute } from "./routes/settings";
import { assetsRoute } from "./routes/assets";

const app = new Hono<AppEnv>();

app.use("*", cors({
  origin: (origin) => origin || "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));
app.use("*", requireAuth);

app.route("/auth", authRoute);

// --- Rotas de negócio ---
app.route("/models", modelsRoute);
app.route("/models", referencesRoute);
app.route("/models", generationRoute);
app.route("/models", socialRoute);

app.route("/", trendsRoute);
app.route("/providers", providersRoute);
app.route("/", libraryRoute);
app.route("/automations", automationsRoute);
app.route("/", settingsRoute);
app.route("/assets", assetsRoute);

app.get("/", (c) => c.json({ name: "Yasmin AI Studio API", status: "online" }));

app.notFound(() => fail("Rota não encontrada", 404));

app.onError((err) => {
  console.error(err);
  return fail(err instanceof Error ? err.message : "Erro interno", 500);
});

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runAutomationRules(env).then((result) => {
        console.log("Automation cron completed", result);
      })
    );
  },
};
