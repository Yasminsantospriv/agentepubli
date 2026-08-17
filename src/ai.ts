import {
  CAPTION_SCHEMA,
  CREATIVE_BRIEF_SCHEMA,
  IMAGE_AUDIT_SCHEMA,
  auditPasses,
  buildAuditPrompt,
  buildCaptionPrompt,
  buildImagePrompt,
  buildTrendAnalysisPrompt
} from "./prompts";
import type { CreativeBrief, GeneratedAsset, IdentityRef, ImageAudit, TrendCandidate } from "./types";
import { base64ToBytes, detectImageType, extractJson, isRecord, readStreamLimited, toDataUrl } from "./utils";

interface BinaryImage {
  bytes: Uint8Array;
  contentType: string;
}

type AIRunner = { run(model: string, input: unknown): Promise<unknown> };

function runner(env: Env): AIRunner {
  return env.AI as unknown as AIRunner;
}

async function resultText(result: unknown): Promise<string> {
  if (typeof result === "string") return result;
  if (result instanceof Response) {
    return new TextDecoder().decode(await readStreamLimited(result.body, 1_000_000));
  }
  if (!isRecord(result)) throw new Error("AI returned an unsupported response");
  if (typeof result.response === "string") return result.response;
  if (typeof result.result === "string") return result.result;
  if (Array.isArray(result.choices)) {
    const first = result.choices[0];
    if (isRecord(first) && isRecord(first.message)) {
      const content = first.message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const text = content
          .filter(isRecord)
          .map((part) => typeof part.text === "string" ? part.text : "")
          .join("");
        if (text) return text;
      }
    }
  }
  return JSON.stringify(result);
}

async function runJson<T>(
  env: Env,
  prompt: string,
  schemaName: string,
  schema: unknown,
  images: BinaryImage[] = []
): Promise<T> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: toDataUrl(image.bytes, image.contentType) } });
  }
  const baseInput = {
    messages: [{ role: "user", content }],
    temperature: 0.25,
    max_tokens: 1_800
  };
  let result: unknown;
  try {
    result = await runner(env).run(env.VISION_MODEL, {
      ...baseInput,
      response_format: {
        type: "json_schema",
        json_schema: { name: schemaName, strict: true, schema }
      }
    });
  } catch {
    result = await runner(env).run(env.VISION_MODEL, baseInput);
  }
  return extractJson<T>(await resultText(result));
}

export async function createCreativeBrief(
  env: Env,
  candidate: TrendCandidate,
  reference: BinaryImage,
  brandProfile: Record<string, unknown>,
  contentPolicy: Record<string, unknown>
): Promise<CreativeBrief> {
  return runJson<CreativeBrief>(
    env,
    buildTrendAnalysisPrompt(candidate, brandProfile, contentPolicy),
    "creative_brief",
    CREATIVE_BRIEF_SCHEMA,
    [reference]
  );
}

export async function createCaption(
  env: Env,
  brief: CreativeBrief,
  captionStyle: Record<string, unknown>
): Promise<string> {
  const result = await runJson<{ caption: string; hashtags: string[] }>(
    env,
    buildCaptionPrompt(brief, captionStyle),
    "instagram_caption",
    CAPTION_SCHEMA
  );
  const caption = String(result.caption ?? "").trim().slice(0, 180);
  const tags = (Array.isArray(result.hashtags) ? result.hashtags : [])
    .map((tag) => String(tag).trim().replace(/^#*/u, ""))
    .filter(Boolean)
    .slice(0, 3)
    .map((tag) => `#${tag}`);
  return `${caption}${tags.length ? `\n\n${tags.join(" ")}` : ""}`.trim();
}

async function loadIdentityImages(bucket: R2Bucket, refs: IdentityRef[]): Promise<BinaryImage[]> {
  const images: BinaryImage[] = [];
  for (const ref of refs.slice(0, 3)) {
    const object = await bucket.get(ref.r2_key);
    if (!object) throw new Error(`Identity reference ${ref.id} is missing from storage`);
    if (object.size > 1_100_000) throw new Error(`Identity reference ${ref.id} is too large`);
    images.push({
      bytes: new Uint8Array(await object.arrayBuffer()),
      contentType: ref.content_type
    });
  }
  return images;
}

async function generatedBytes(result: unknown): Promise<Uint8Array> {
  if (result instanceof Response) return readStreamLimited(result.body, 8_000_000);
  if (result instanceof Uint8Array) return result;
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof ReadableStream) return readStreamLimited(result as ReadableStream<Uint8Array>, 8_000_000);
  if (isRecord(result)) {
    const value = result.image ?? result.data ?? result.result;
    if (typeof value === "string") {
      const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
      return base64ToBytes(base64);
    }
    if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
      return new Uint8Array(value as number[]);
    }
  }
  throw new Error("Image model returned an unsupported response");
}

async function generateImage(env: Env, prompt: string, identityImages: BinaryImage[]): Promise<BinaryImage> {
  const form = new FormData();
  form.set("prompt", prompt);
  form.set("steps", "28");
  form.set("width", "1024");
  form.set("height", "1280");
  for (const [index, image] of identityImages.slice(0, 3).entries()) {
    form.set(`input_image_${index}`, new File([new Uint8Array(image.bytes).buffer], `yasmin-${index}.${image.contentType.split("/")[1]}`, {
      type: image.contentType
    }));
  }
  const bytes = await generatedBytes(await runner(env).run(env.IMAGE_MODEL, form));
  const contentType = detectImageType(bytes);
  if (contentType === "application/octet-stream") throw new Error("Image model returned invalid image bytes");
  return { bytes, contentType };
}

async function auditImage(
  env: Env,
  image: BinaryImage,
  identityImage: BinaryImage,
  brandProfile: Record<string, unknown>
): Promise<ImageAudit> {
  return runJson<ImageAudit>(
    env,
    `${buildAuditPrompt(brandProfile)}\nImage 0 is the generated image. Image 1 is a canonical Yasmin identity reference used only for comparison.`,
    "image_audit",
    IMAGE_AUDIT_SCHEMA,
    [image, identityImage]
  );
}

function extension(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export async function generateCarouselAsset(
  env: Env,
  runId: string,
  position: number,
  brief: CreativeBrief,
  brandProfile: Record<string, unknown>,
  identityRefs: IdentityRef[]
): Promise<GeneratedAsset> {
  const identityImages = await loadIdentityImages(env.BUCKET, identityRefs);
  if (identityImages.length < 2) throw new Error("At least two identity references are required");

  let finalImage: BinaryImage | null = null;
  let finalAudit: ImageAudit | null = null;
  let finalPrompt = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    finalPrompt = buildImagePrompt(brief, brandProfile, position, attempt === 1);
    finalImage = await generateImage(env, finalPrompt, identityImages);
    finalAudit = await auditImage(env, finalImage, identityImages[0], brandProfile);
    if (auditPasses(finalAudit)) break;
  }

  if (!finalImage || !finalAudit) throw new Error("Image generation did not return an auditable result");
  const key = `private/generated/${runId}/${position}.${extension(finalImage.contentType)}`;
  await env.BUCKET.put(key, finalImage.bytes, {
    httpMetadata: { contentType: finalImage.contentType, cacheControl: "private, max-age=0" },
    customMetadata: { runId, position: String(position) }
  });
  return {
    key,
    contentType: finalImage.contentType,
    width: 1024,
    height: 1280,
    prompt: finalPrompt,
    audit: finalAudit,
    status: auditPasses(finalAudit) ? "passed" : "blocked",
    position
  };
}
