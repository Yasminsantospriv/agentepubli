import { Hono } from "hono";
import type { AppEnv, GenerationFormat, IdentityLock } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { ok, created, fail, notFound, newId, nowIso } from "../lib/response";
import { buildGeneratedKey, uploadToR2 } from "../lib/storage";
import { buildFinalPrompt, type ModelIdentityRow } from "../lib/prompt-engine";
import { buildProviderRegistry, orderProvidersAutomatic, generateWithFallback, getProvider } from "../providers/registry";
import type { GenerateImageResult, ReferenceImageInput } from "../providers/types";
import { rateLimit } from "../lib/rate-limit";
import { loadInspirationReference } from "../services/instagram-inspiration";

export const generationRoute = new Hono<AppEnv>();

type GenerateRequestBody = {
  user_request: string;
  format?: GenerationFormat;
  quantity?: number;
  identity_lock?: IdentityLock;
  clothing_description?: string;
  scene_description?: string;
  provider_slug?: string;
  inspiration_id?: string;
};

type ReferenceRow = {
  id: string;
  reference_type: string;
  priority: number;
  is_master_face: number;
  is_master_body: number;
  is_master_full: number;
};

generationRoute.post("/:slug/generate", rateLimit({ namespace: "generate", limit: 8, windowSeconds: 60 }), async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");

  const body = await c.req.json<GenerateRequestBody>();
  if (!body.user_request) return fail("user_request é obrigatório");

  const identity = await dbFirst<ModelIdentityRow>(c.env.DB, "SELECT * FROM model_identity WHERE model_id = ?", model.id);
  const identityLock = body.identity_lock ?? "STRONG";
  const basePrompt = buildFinalPrompt({
    identity,
    userRequest: body.user_request,
    clothingDescription: body.clothing_description,
    sceneDescription: body.scene_description,
    identityLock,
    format: body.format ?? "1:1",
  });

  const references = await dbAll<ReferenceRow>(
    c.env.DB,
    `SELECT id, reference_type, priority, is_master_face, is_master_body, is_master_full
     FROM model_references
     WHERE model_id = ? AND active = 1
     ORDER BY is_master_face DESC, is_master_body DESC, is_master_full DESC, priority DESC, created_at DESC
     LIMIT 12`,
    model.id
  );

  const referenceImages: ReferenceImageInput[] = [];
  const referenceSnapshot: Array<Record<string, unknown>> = [];
  let hasPostInspiration = false;

  if (body.inspiration_id) {
    const inspiration = await loadInspirationReference(c.env, body.inspiration_id).catch(() => null);
    if (inspiration) {
      referenceImages.push({ data: inspiration.data, contentType: inspiration.contentType, role: "inspiration" });
      referenceSnapshot.push({ inspiration_id: body.inspiration_id, type: "INSTAGRAM_INSPIRATION" });
      hasPostInspiration = true;
    }
  }

  const identitySlots = Math.max(0, 4 - referenceImages.length);
  for (const ref of references) {
    if (referenceImages.length >= 4 || referenceSnapshot.filter((x) => x.type === "IDENTITY_REFERENCE").length >= identitySlots) break;
    const object = await c.env.ASSETS_BUCKET.get(`ai-ready/references/${ref.id}.jpg`);
    if (!object) continue;
    referenceImages.push({
      data: await object.arrayBuffer(),
      contentType: object.httpMetadata?.contentType || "image/jpeg",
      role: ref.reference_type === "BODY" ? "body" : ref.reference_type === "HAIR" ? "hair" : "identity",
    });
    referenceSnapshot.push({
      id: ref.id,
      type: "IDENTITY_REFERENCE",
      reference_type: ref.reference_type,
      master_face: !!ref.is_master_face,
      master_body: !!ref.is_master_body,
      master_full: !!ref.is_master_full,
    });
  }

  let finalPrompt = basePrompt.prompt;
  if (referenceImages.length) {
    const referenceInstruction = hasPostInspiration
      ? "A imagem de referência 0 é apenas inspiração de postagem: use composição, enquadramento, pose geral, iluminação, atmosfera e estilo de roupa, sem copiar rosto, identidade, texto, marcas ou detalhes exclusivos. As demais imagens de referência definem a identidade visual da Yasmin e têm prioridade absoluta para rosto, corpo e cabelo."
      : "As imagens de referência fornecidas definem a identidade visual da Yasmin. Preserve rosto, proporções, cabelo e características consistentes com elas.";
    finalPrompt = `${referenceInstruction}\n\n${basePrompt.prompt}`;
  }

  const jobId = newId();
  const now = nowIso();
  await dbRun(
    c.env.DB,
    `INSERT INTO generation_jobs (
      id, model_id, user_request, final_prompt, negative_prompt, format, quantity,
      identity_lock, references_used, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)`,
    jobId,
    model.id,
    body.user_request,
    finalPrompt,
    basePrompt.negativePrompt,
    body.format ?? "1:1",
    body.quantity ?? 1,
    identityLock,
    JSON.stringify(referenceSnapshot),
    now
  );

  await logActivity(c.env.DB, model.id, "GENERATION_STARTED", `Job ${jobId} iniciado`);

  const registry = buildProviderRegistry(c.env);
  const freeFirst = c.env.FREE_FIRST_MODE === "true";
  const orderedProviders = body.provider_slug
    ? [getProvider(c.env, body.provider_slug)].filter((p): p is NonNullable<typeof p> => !!p)
    : orderProvidersAutomatic(registry, freeFirst);

  if (orderedProviders.length === 0) {
    await dbRun(c.env.DB, "UPDATE generation_jobs SET status = 'FAILED', error = ?, completed_at = ? WHERE id = ?", "Nenhum provider configurado", nowIso(), jobId);
    return fail("Nenhum provider de IA está configurado. Configure em Configurações → Provedores de IA.", 503);
  }

  const dimensions = dimensionsForFormat(body.format ?? "1:1");
  try {
    const { result, attempts } = await generateWithFallback(orderedProviders, {
      prompt: finalPrompt,
      negativePrompt: basePrompt.negativePrompt,
      quantity: body.quantity ?? 1,
      width: dimensions.width,
      height: dimensions.height,
      referenceImages,
    });

    const assets = [];
    for (const image of result.images) {
      const assetId = newId();
      const ext = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
      const key = buildGeneratedKey(slug, jobId, assetId, ext);
      await uploadToR2(c.env.ASSETS_BUCKET, key, image.data, image.contentType);
      await dbRun(
        c.env.DB,
        `INSERT INTO generated_assets (
          id, generation_id, storage_key, provider_slug, width, height, format, approval_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        assetId,
        jobId,
        key,
        result.providerSlug,
        image.width ?? dimensions.width,
        image.height ?? dimensions.height,
        ext,
        nowIso()
      );
      assets.push({ id: assetId, storage_key: key });
    }

    await dbRun(
      c.env.DB,
      `UPDATE generation_jobs SET status = 'COMPLETED', provider_model_name = ?, settings = ?, attempted_providers = ?, completed_at = ? WHERE id = ?`,
      result.modelUsed ?? result.providerSlug,
      JSON.stringify({
        provider_slug: result.providerSlug,
        reference_images: referenceImages.length,
        inspiration_id: body.inspiration_id ?? null,
      }),
      JSON.stringify(attempts),
      nowIso(),
      jobId
    );

    await logActivity(c.env.DB, model.id, "GENERATION_COMPLETED", `Job ${jobId} concluído via ${result.providerSlug}`);
    const job = await dbFirst(c.env.DB, "SELECT * FROM generation_jobs WHERE id = ?", jobId);
    return created({ job, assets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dbRun(c.env.DB, "UPDATE generation_jobs SET status = 'FAILED', error = ?, completed_at = ? WHERE id = ?", message, nowIso(), jobId);
    await logActivity(c.env.DB, model.id, "GENERATION_FAILED", message);
    return fail(`Falha na geração: ${message}`, 502);
  }
});

generationRoute.post(
  "/assets/:id/edit",
  rateLimit({ namespace: "edit", limit: 6, windowSeconds: 60 }),
  async (c) => {
    const assetId = c.req.param("id");
    const body = await c.req.json<{ prompt?: string; provider_slug?: string }>();
    if (!body.prompt) return fail("prompt é obrigatório");

    const source = await dbFirst<{
      asset_id: string;
      storage_key: string;
      model_id: string;
      model_slug: string;
      content_type: string | null;
    }>(
      c.env.DB,
      `SELECT a.id AS asset_id, a.storage_key, j.model_id, m.slug AS model_slug, NULL AS content_type
       FROM generated_assets a
       JOIN generation_jobs j ON j.id = a.generation_id
       JOIN models m ON m.id = j.model_id
       WHERE a.id = ?`,
      assetId
    );
    if (!source) return notFound("Asset");

    const object = await c.env.ASSETS_BUCKET.get(source.storage_key);
    if (!object) return notFound("Arquivo do asset");
    const imageData = await object.arrayBuffer();
    const imageContentType = object.httpMetadata?.contentType || "image/jpeg";

    const registry = buildProviderRegistry(c.env);
    const providers = body.provider_slug
      ? [getProvider(c.env, body.provider_slug)].filter((p): p is NonNullable<typeof p> => !!p)
      : orderProvidersAutomatic(registry, c.env.FREE_FIRST_MODE === "true");

    if (providers.length === 0) return fail("Nenhum provider configurado para edição.", 503);

    const attempts: Array<{ provider: string; error: string }> = [];
    let editResult: GenerateImageResult | null = null;

    for (const provider of providers) {
      if (!provider.isConfigured()) continue;
      try {
        const result = await provider.editImage({ imageData, imageContentType, prompt: body.prompt });
        if (result === "unsupported_feature") {
          attempts.push({ provider: provider.slug, error: "unsupported_feature" });
          continue;
        }
        editResult = result;
        break;
      } catch (err) {
        attempts.push({ provider: provider.slug, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (!editResult) return fail("Nenhum provider conseguiu editar a imagem.", 502, attempts);

    const jobId = newId();
    const editNow = nowIso();
    await dbRun(
      c.env.DB,
      `INSERT INTO generation_jobs
       (id, model_id, user_request, final_prompt, format, quantity, identity_lock, status, attempted_providers, settings, created_at, completed_at, provider_model_name)
       VALUES (?, ?, ?, ?, '1:1', 1, 'STRONG', 'COMPLETED', ?, ?, ?, ?, ?)`,
      jobId,
      source.model_id,
      `Edit asset ${assetId}: ${body.prompt}`,
      body.prompt,
      JSON.stringify(attempts),
      JSON.stringify({ operation: "edit", source_asset_id: assetId, provider_slug: editResult.providerSlug }),
      editNow,
      editNow,
      editResult.modelUsed ?? editResult.providerSlug
    );

    const createdAssets = [];
    for (const image of editResult.images) {
      const newAssetId = newId();
      const ext = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
      const key = buildGeneratedKey(source.model_slug, jobId, newAssetId, ext);
      await uploadToR2(c.env.ASSETS_BUCKET, key, image.data, image.contentType);
      await dbRun(
        c.env.DB,
        `INSERT INTO generated_assets
         (id, generation_id, storage_key, provider_slug, width, height, format, approval_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        newAssetId,
        jobId,
        key,
        editResult.providerSlug,
        image.width ?? null,
        image.height ?? null,
        ext,
        nowIso()
      );
      createdAssets.push({ id: newAssetId, storage_key: key });
    }

    await logActivity(c.env.DB, source.model_id, "IMAGE_EDITED", `Asset ${assetId} editado via ${editResult.providerSlug}`);
    return created({ job_id: jobId, source_asset_id: assetId, assets: createdAssets, attempts });
  }
);

generationRoute.get("/generation-jobs/:id", async (c) => {
  const id = c.req.param("id");
  const job = await dbFirst(c.env.DB, "SELECT * FROM generation_jobs WHERE id = ?", id);
  if (!job) return notFound("Job de geração");
  const assets = await dbAll(c.env.DB, "SELECT * FROM generated_assets WHERE generation_id = ?", id);
  return ok({ job, assets });
});

generationRoute.get("/:slug/generation-jobs", async (c) => {
  const slug = c.req.param("slug");
  const model = await dbFirst<{ id: string }>(c.env.DB, "SELECT id FROM models WHERE slug = ?", slug);
  if (!model) return notFound("Modelo");
  const rows = await dbAll(c.env.DB, "SELECT * FROM generation_jobs WHERE model_id = ? ORDER BY created_at DESC LIMIT 50", model.id);
  return ok(rows);
});

generationRoute.post("/assets/:id/approve", async (c) => {
  const id = c.req.param("id");
  await dbRun(c.env.DB, "UPDATE generated_assets SET approval_status = 'APPROVED' WHERE id = ?", id);
  const row = await dbFirst(c.env.DB, "SELECT * FROM generated_assets WHERE id = ?", id);
  if (!row) return notFound("Asset");
  return ok(row);
});

generationRoute.post("/assets/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string }>();
  const asset = await dbFirst<{ id: string; generation_id: string }>(c.env.DB, "SELECT id, generation_id FROM generated_assets WHERE id = ?", id);
  if (!asset) return notFound("Asset");
  await dbRun(c.env.DB, "UPDATE generated_assets SET approval_status = 'REJECTED', rejection_reason = ? WHERE id = ?", body.reason ?? null, id);
  const job = await dbFirst<{ model_id: string }>(c.env.DB, "SELECT model_id FROM generation_jobs WHERE id = ?", asset.generation_id);
  if (job) {
    await dbRun(
      c.env.DB,
      `INSERT INTO learning_signals (id, asset_id, model_id, signal, reason, created_at) VALUES (?, ?, ?, 'NEGATIVE', ?, ?)`,
      newId(),
      id,
      job.model_id,
      body.reason ?? null,
      nowIso()
    );
  }
  const row = await dbFirst(c.env.DB, "SELECT * FROM generated_assets WHERE id = ?", id);
  return ok(row);
});

generationRoute.post("/assets/:id/favorite", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ favorite: boolean }>();
  await dbRun(c.env.DB, "UPDATE generated_assets SET favorite = ? WHERE id = ?", body.favorite ? 1 : 0, id);
  const row = await dbFirst(c.env.DB, "SELECT * FROM generated_assets WHERE id = ?", id);
  if (!row) return notFound("Asset");
  return ok(row);
});

function dimensionsForFormat(format: GenerationFormat) {
  if (format === "4:5") return { width: 1024, height: 1280 };
  if (format === "9:16") return { width: 768, height: 1344 };
  if (format === "landscape") return { width: 1280, height: 768 };
  return { width: 1024, height: 1024 };
}

async function logActivity(db: D1Database, modelId: string, eventType: string, description: string) {
  await dbRun(
    db,
    `INSERT INTO activity_logs (id, model_id, event_type, description, created_at) VALUES (?, ?, ?, ?, ?)`,
    newId(),
    modelId,
    eventType,
    description,
    nowIso()
  );
}
