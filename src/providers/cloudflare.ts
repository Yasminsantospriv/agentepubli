// ============================================================================
// CloudflareProvider — usa Workers AI (binding nativo, sem API key externa)
// Ideal como provider padrão no modo FREE-FIRST.
// ============================================================================

import type {
  ImageProvider,
  GenerateImageOptions,
  GenerateImageResult,
  EditImageOptions,
  TestConnectionResult,
} from "./types";
import { UNSUPPORTED_FEATURE } from "./types";

const DEFAULT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export class CloudflareProvider implements ImageProvider {
  readonly slug = "cloudflare";
  readonly name = "Cloudflare AI";

  constructor(private ai: Ai) {}

  isConfigured(): boolean {
    // O binding AI está sempre disponível quando declarado no wrangler.jsonc
    return !!this.ai;
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    const model = options.model || DEFAULT_MODEL;
    const quantity = options.quantity ?? 1;

    const images: GenerateImageResult["images"] = [];

    for (let i = 0; i < quantity; i++) {
      const result = await this.ai.run(model as keyof AiModels, {
        prompt: options.prompt,
        negative_prompt: options.negativePrompt,
        width: options.width ?? 1024,
        height: options.height ?? 1024,
      } as never);

      // Workers AI retorna um stream/base64 dependendo do modelo — normalizamos para ArrayBuffer.
      const data = await normalizeAiImageOutput(result);
      images.push({ data, contentType: "image/jpeg", width: options.width, height: options.height });
    }

    return { images, providerSlug: this.slug, modelUsed: model };
  }

  async editImage(_options: EditImageOptions): Promise<GenerateImageResult | typeof UNSUPPORTED_FEATURE> {
    // FLUX.2 aceita referências visuais, mas o limite atual de tamanho das imagens de entrada
    // exige um pipeline de resize antes de editar os assets 1024px gerados por este projeto.
    // Até esse pipeline existir, não anunciamos edição Cloudflare como funcional.
    return UNSUPPORTED_FEATURE;
  }

  async getModels(): Promise<string[]> {
    return [
      "@cf/black-forest-labs/flux-1-schnell",
      "@cf/black-forest-labs/flux-2-klein-4b",
      "@cf/stabilityai/stable-diffusion-xl-base-1.0",
      "@cf/lykon/dreamshaper-8-lcm",
    ];
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      await this.ai.run(DEFAULT_MODEL as keyof AiModels, {
        prompt: "test connection, single pixel",
        width: 256,
        height: 256,
      } as never);
      return { success: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

async function normalizeAiImageOutput(result: unknown): Promise<ArrayBuffer> {
  if (result instanceof ReadableStream) {
    const response = new Response(result);
    return response.arrayBuffer();
  }
  if (result instanceof ArrayBuffer) {
    return result;
  }
  if (result && typeof result === "object" && "image" in result) {
    // Alguns modelos retornam { image: base64string }
    const base64 = (result as { image: string }).image;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  throw new Error("Formato de saída do Workers AI não reconhecido");
}
