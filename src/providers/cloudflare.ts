// ============================================================================
// CloudflareProvider — Workers AI com FLUX.2 klein 4B em modo FREE-FIRST.
// Suporta texto + até 4 imagens de referência AI-ready (< 512 px).
// ============================================================================

import type {
  ImageProvider,
  GenerateImageOptions,
  GenerateImageResult,
  EditImageOptions,
  TestConnectionResult,
} from "./types";
import { UNSUPPORTED_FEATURE } from "./types";

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export class CloudflareProvider implements ImageProvider {
  readonly slug = "cloudflare";
  readonly name = "Cloudflare AI";

  constructor(private ai: Ai, private configuredModel?: string) {}

  isConfigured(): boolean {
    return !!this.ai;
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    const model = options.model || this.configuredModel || DEFAULT_MODEL;
    const quantity = Math.max(1, Math.min(4, options.quantity ?? 1));
    const images: GenerateImageResult["images"] = [];

    for (let i = 0; i < quantity; i++) {
      const form = new FormData();
      const prompt = options.negativePrompt
        ? `${options.prompt}\n\nEvite: ${options.negativePrompt}`
        : options.prompt;
      form.append("prompt", prompt);
      form.append("width", String(options.width ?? 1024));
      form.append("height", String(options.height ?? 1024));

      for (const [index, ref] of (options.referenceImages || []).slice(0, 4).entries()) {
        const mime = ref.contentType || "image/jpeg";
        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
        form.append(`input_image_${index}`, new Blob([ref.data], { type: mime }), `ref-${index}.${ext}`);
      }

      const encoded = new Response(form);
      const contentType = encoded.headers.get("content-type");
      if (!encoded.body || !contentType) throw new Error("Não foi possível montar o multipart do Workers AI");

      const result = await this.ai.run(model as keyof AiModels, {
        multipart: {
          body: encoded.body,
          contentType,
        },
      } as never);

      const data = await normalizeAiImageOutput(result);
      images.push({
        data,
        contentType: "image/jpeg",
        width: options.width,
        height: options.height,
      });
    }

    return { images, providerSlug: this.slug, modelUsed: model };
  }

  async editImage(_options: EditImageOptions): Promise<GenerateImageResult | typeof UNSUPPORTED_FEATURE> {
    return UNSUPPORTED_FEATURE;
  }

  async getModels(): Promise<string[]> {
    return [
      "@cf/black-forest-labs/flux-2-klein-4b",
      "@cf/black-forest-labs/flux-2-dev",
      "@cf/black-forest-labs/flux-1-schnell",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    ];
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const form = new FormData();
      form.append("prompt", "simple studio light test image");
      form.append("width", "256");
      form.append("height", "256");
      const encoded = new Response(form);
      const contentType = encoded.headers.get("content-type");
      if (!encoded.body || !contentType) throw new Error("Multipart inválido");
      await this.ai.run((this.configuredModel || DEFAULT_MODEL) as keyof AiModels, {
        multipart: { body: encoded.body, contentType },
      } as never);
      return { success: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function normalizeAiImageOutput(result: unknown): Promise<ArrayBuffer> {
  if (result instanceof ReadableStream) {
    return new Response(result).arrayBuffer();
  }
  if (result instanceof ArrayBuffer) return result;
  if (result && typeof result === "object" && "image" in result) {
    const base64 = (result as { image: string }).image;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  throw new Error("Formato de saída do Workers AI não reconhecido");
}
