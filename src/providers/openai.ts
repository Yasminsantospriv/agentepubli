// ============================================================================
// OpenAIProvider — geração de imagem via API da OpenAI (gpt-image-1)
// ============================================================================

import type {
  ImageProvider,
  GenerateImageOptions,
  GenerateImageResult,
  EditImageOptions,
  TestConnectionResult,
} from "./types";
import { ProviderNotConfiguredError } from "./types";

const API_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-image-1";

export class OpenAIProvider implements ImageProvider {
  readonly slug = "openai";
  readonly name = "OpenAI";

  constructor(private apiKey: string | undefined) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private headers() {
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.slug);
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
    const model = options.model || DEFAULT_MODEL;
    const size = mapSize(options.width, options.height);

    const response = await fetch(`${API_BASE}/images/generations`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model,
        prompt: options.prompt,
        n: options.quantity ?? 1,
        size,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI retornou ${response.status}: ${errorText}`);
    }

    const json = (await response.json()) as { data: Array<{ b64_json: string }> };

    const images = json.data.map((item) => ({
      data: base64ToArrayBuffer(item.b64_json),
      contentType: "image/png",
    }));

    return { images, providerSlug: this.slug, modelUsed: model, raw: json };
  }

  async editImage(options: EditImageOptions): Promise<GenerateImageResult> {
    if (!this.apiKey) throw new ProviderNotConfiguredError(this.slug);

    const form = new FormData();
    form.append("model", String(options.extra?.model ?? DEFAULT_MODEL));
    form.append("prompt", options.prompt);
    form.append("image", new Blob([options.imageData], { type: options.imageContentType }), "image.png");
    form.append("output_format", "png");
    if (options.maskData) {
      form.append("mask", new Blob([options.maskData], { type: "image/png" }), "mask.png");
    }

    const response = await fetch(`${API_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI retornou ${response.status}: ${errorText}`);
    }

    const json = (await response.json()) as { data: Array<{ b64_json: string }> };
    const images = json.data.map((item) => ({
      data: base64ToArrayBuffer(item.b64_json),
      contentType: "image/png",
    }));

    return { images, providerSlug: this.slug, modelUsed: String(options.extra?.model ?? DEFAULT_MODEL), raw: json };
  }

  async getModels(): Promise<string[]> {
    return ["gpt-image-1", "dall-e-3"];
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    try {
      const response = await fetch(`${API_BASE}/models/${DEFAULT_MODEL}`, {
        headers: this.headers(),
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function mapSize(width?: number, height?: number): string {
  if (!width || !height) return "1024x1024";
  if (width === height) return "1024x1024";
  return width > height ? "1536x1024" : "1024x1536";
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
