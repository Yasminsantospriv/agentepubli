import {
  addIdentityRef,
  addSource,
  ensureRun,
  getRun,
  getRunContext,
  listIdentityRefs,
  listRuns,
  listSources,
  setIdentityRefActive,
  setSourceActive,
  updateRun
} from "./db";
import { corsHeaders, isAuthorized, signedAssetUrl, verifyAssetSignature } from "./security";
import type { IdentityRef, Platform, WatchSource } from "./types";
import { detectImageType, imageDimensions, jsonResponse, nowIso, readJson } from "./utils";

export { ContentWorkflow } from "./workflow";

interface SourceInput {
  platform?: Platform;
  handle?: string;
  externalUrl?: string;
  declaredAge?: number;
  adultVerified?: boolean;
  notes?: string;
}

interface DecisionInput {
  decision?: "approved" | "rejected";
  notes?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env.DASHBOARD_ORIGIN))) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function validSource(input: SourceInput): { source?: WatchSource; error?: string } {
  if (input.platform !== "instagram" && input.platform !== "tiktok") return { error: "platform must be instagram or tiktok" };
  if (!Number.isInteger(input.declaredAge) || (input.declaredAge as number) < 19 || (input.declaredAge as number) > 23) {
    return { error: "declaredAge must be an integer from 19 to 23" };
  }
  if (input.adultVerified !== true) return { error: "adultVerified must be explicitly confirmed" };
  const handle = input.handle?.trim().replace(/^@/u, "") || null;
  if (handle && !/^[A-Za-z0-9._]{1,50}$/u.test(handle)) return { error: "invalid handle" };
  let externalUrl = input.externalUrl?.trim() || null;
  if (externalUrl) {
    try {
      const parsed = new URL(externalUrl);
      if (parsed.protocol !== "https:") return { error: "externalUrl must use HTTPS" };
      externalUrl = parsed.toString();
    } catch {
      return { error: "externalUrl is invalid" };
    }
  }
  if (input.platform === "instagram" && !handle) return { error: "Instagram sources require a handle" };
  if (input.platform === "tiktok" && !externalUrl) return { error: "TikTok sources require a public post URL" };
  return {
    source: {
      id: crypto.randomUUID(),
      platform: input.platform,
      handle,
      external_url: externalUrl,
      declared_age: input.declaredAge as number,
      adult_verified_at: nowIso(),
      notes: input.notes?.trim().slice(0, 500) || null,
      active: 1
    }
  };
}

async function assetResponse(request: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get("key") ?? "";
  const signature = url.searchParams.get("sig") ?? "";
  const expires = Number.parseInt(url.searchParams.get("expires") ?? "", 10);
  if (!key.startsWith("private/") || key.length > 512 || !env.ASSET_SIGNING_SECRET) {
    return jsonResponse({ error: "Invalid asset request" }, 400);
  }
  if (!await verifyAssetSignature(key, expires, signature, env.ASSET_SIGNING_SECRET)) {
    return jsonResponse({ error: "Asset link is invalid or expired" }, 403);
  }
  const object = await env.BUCKET.get(key);
  if (!object) return jsonResponse({ error: "Asset not found" }, 404);
  const headers = new Headers({
    "cache-control": "private, max-age=300",
    "content-security-policy": "default-src 'none'",
    "x-content-type-options": "nosniff",
    etag: object.httpEtag
  });
  object.writeHttpMetadata(headers);
  headers.set("content-disposition", url.searchParams.get("download") === "1" ? "attachment" : "inline");
  return new Response(object.body, { headers });
}

async function runDetails(request: Request, env: Env, runId: string): Promise<Response> {
  const details = await getRun(env.DB, runId);
  if (!details) return jsonResponse({ error: "Run not found" }, 404);
  const origin = new URL(request.url).origin;
  const assets = await Promise.all(details.assets.map(async (asset) => ({
    ...asset,
    r2_key: undefined,
    url: await signedAssetUrl(origin, asset.r2_key, env.ASSET_SIGNING_SECRET),
    downloadUrl: `${await signedAssetUrl(origin, asset.r2_key, env.ASSET_SIGNING_SECRET)}&download=1`
  })));
  return jsonResponse({ ...details, assets });
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!await isAuthorized(request, env.ADMIN_API_TOKEN)) return jsonResponse({ error: "Unauthorized" }, 401);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/api/status") {
    const context = await getRunContext(env.DB);
    const runs = await listRuns(env.DB, 1);
    return jsonResponse({
      ready: context.identityRefs.length >= 3 && context.sources.length > 0,
      identityReferences: context.identityRefs.length,
      activeSources: context.sources.length,
      instagramConfigured: Boolean(env.INSTAGRAM_USER_ID && env.INSTAGRAM_ACCESS_TOKEN),
      schedule: "Todos os dias às 09:00 (America/Sao_Paulo)",
      lastRun: runs[0] ?? null
    });
  }

  if (method === "GET" && url.pathname === "/api/sources") return jsonResponse({ sources: await listSources(env.DB) });
  if (method === "POST" && url.pathname === "/api/sources") {
    const validation = validSource(await readJson<SourceInput>(request));
    if (!validation.source) return jsonResponse({ error: validation.error }, 400);
    await addSource(env.DB, validation.source);
    return jsonResponse({ source: validation.source }, 201);
  }
  const sourceMatch = url.pathname.match(/^\/api\/sources\/([0-9a-f-]+)$/u);
  if (method === "PATCH" && sourceMatch) {
    const input = await readJson<{ active?: boolean }>(request);
    if (typeof input.active !== "boolean") return jsonResponse({ error: "active must be boolean" }, 400);
    const changed = await setSourceActive(env.DB, sourceMatch[1], input.active);
    return changed ? jsonResponse({ ok: true }) : jsonResponse({ error: "Source not found" }, 404);
  }

  if (method === "GET" && url.pathname === "/api/identity") {
    const origin = url.origin;
    const refs = await listIdentityRefs(env.DB);
    const output = await Promise.all(refs.map(async (ref) => ({
      ...ref,
      r2_key: undefined,
      url: await signedAssetUrl(origin, ref.r2_key, env.ASSET_SIGNING_SECRET)
    })));
    return jsonResponse({ identityReferences: output });
  }
  if (method === "POST" && url.pathname === "/api/identity") {
    const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (declaredLength > 1_400_000) return jsonResponse({ error: "Upload exceeds 1 MB" }, 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > 1_100_000) {
      return jsonResponse({ error: "file must be a JPEG, PNG or WebP image up to 1 MB" }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = detectImageType(bytes);
    const dimensions = imageDimensions(bytes, contentType);
    if (!dimensions || dimensions.width < 128 || dimensions.height < 128 || dimensions.width > 512 || dimensions.height > 512) {
      return jsonResponse({ error: "Identity image dimensions must be between 128 and 512 pixels per side" }, 400);
    }
    const id = crypto.randomUUID();
    const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const key = `private/identity/${id}.${extension}`;
    const ref: IdentityRef = {
      id,
      r2_key: key,
      label: String(form.get("label") ?? `Yasmin ${id.slice(0, 6)}`).slice(0, 80),
      content_type: contentType,
      width: dimensions.width,
      height: dimensions.height,
      active: 1
    };
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "private, max-age=0" },
      customMetadata: { purpose: "yasmin-canonical-identity" }
    });
    try {
      await addIdentityRef(env.DB, ref);
    } catch (error) {
      await env.BUCKET.delete(key);
      throw error;
    }
    return jsonResponse({ identityReference: { ...ref, r2_key: undefined } }, 201);
  }
  const identityMatch = url.pathname.match(/^\/api\/identity\/([0-9a-f-]+)$/u);
  if (method === "PATCH" && identityMatch) {
    const input = await readJson<{ active?: boolean }>(request);
    if (typeof input.active !== "boolean") return jsonResponse({ error: "active must be boolean" }, 400);
    const changed = await setIdentityRefActive(env.DB, identityMatch[1], input.active);
    return changed ? jsonResponse({ ok: true }) : jsonResponse({ error: "Identity reference not found" }, 404);
  }

  if (method === "GET" && url.pathname === "/api/runs") {
    return jsonResponse({ runs: await listRuns(env.DB, Number.parseInt(url.searchParams.get("limit") ?? "20", 10)) });
  }
  if (method === "POST" && url.pathname === "/api/run") {
    const runId = crypto.randomUUID();
    await ensureRun(env.DB, runId, runId, "manual");
    try {
      const instance = await env.CONTENT_WORKFLOW.create({ id: runId, params: { runId, trigger: "manual" } });
      return jsonResponse({ runId, workflowId: instance.id, status: "running" }, 202);
    } catch (error) {
      await updateRun(env.DB, runId, { status: "failed", error_message: errorMessage(error).slice(0, 500) });
      throw error;
    }
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([0-9a-f-]+)$/u);
  if (method === "GET" && runMatch) return runDetails(request, env, runMatch[1]);

  const decisionMatch = url.pathname.match(/^\/api\/runs\/([0-9a-f-]+)\/decision$/u);
  if (method === "POST" && decisionMatch) {
    const input = await readJson<DecisionInput>(request);
    if (input.decision !== "approved" && input.decision !== "rejected") {
      return jsonResponse({ error: "decision must be approved or rejected" }, 400);
    }
    const details = await getRun(env.DB, decisionMatch[1]);
    if (!details) return jsonResponse({ error: "Run not found" }, 404);
    if (input.decision === "approved" && details.run.status !== "ready") {
      return jsonResponse({ error: "Only a fully audited ready run can be approved" }, 409);
    }
    await updateRun(env.DB, decisionMatch[1], {
      decision: input.decision,
      decision_notes: input.notes?.trim().slice(0, 500) || null,
      decided_at: nowIso(),
      status: input.decision
    });
    return jsonResponse({ ok: true, decision: input.decision });
  }

  const regenerateMatch = url.pathname.match(/^\/api\/runs\/([0-9a-f-]+)\/regenerate$/u);
  if (method === "POST" && regenerateMatch) {
    const sourceRun = await getRun(env.DB, regenerateMatch[1]);
    if (!sourceRun) return jsonResponse({ error: "Run not found" }, 404);
    const runId = crypto.randomUUID();
    await ensureRun(env.DB, runId, runId, "regenerate");
    const instance = await env.CONTENT_WORKFLOW.create({
      id: runId,
      params: { runId, trigger: "regenerate", sourceRunId: regenerateMatch[1] }
    });
    return jsonResponse({ runId, workflowId: instance.id, status: "running" }, 202);
  }

  const workflowMatch = url.pathname.match(/^\/api\/workflows\/([0-9a-f-]+)$/u);
  if (method === "GET" && workflowMatch) {
    const instance = await env.CONTENT_WORKFLOW.get(workflowMatch[1]);
    return jsonResponse(await instance.status());
  }

  return jsonResponse({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "yasmin-trend-agent" });
    }
    if (request.method === "GET" && url.pathname === "/api/asset") {
      return assetResponse(request, env, url);
    }
    if (request.method === "OPTIONS") {
      const headers = corsHeaders(request, env.DASHBOARD_ORIGIN);
      return Object.keys(headers).length > 0 ? new Response(null, { status: 204, headers }) : jsonResponse({ error: "Origin not allowed" }, 403);
    }
    try {
      const response = url.pathname.startsWith("/api/")
        ? await handleApi(request, env, url)
        : jsonResponse({ service: "yasmin-trend-agent", health: "/health" });
      return withCors(response, request, env);
    } catch (error) {
      return withCors(jsonResponse({ error: errorMessage(error).slice(0, 500) }, 500), request, env);
    }
  }
} satisfies ExportedHandler<Env>;
