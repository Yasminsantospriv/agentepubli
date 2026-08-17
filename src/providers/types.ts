// ============================================================================
// Interface comum de providers de geração de imagem
//
// Qualquer novo provider (Replicate, FAL, Stability, um serviço próprio, etc.)
// deve implementar esta interface e ser registrado em registry.ts.
// ============================================================================

export type GenerateImageOptions = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  quantity?: number;
  model?: string;
  extra?: Record<string, unknown>;
};

export type GenerateImageResult = {
  images: Array<{
    data: ArrayBuffer;
    contentType: string;
    width?: number;
    height?: number;
  }>;
  providerSlug: string;
  modelUsed?: string;
  raw?: unknown;
};

export type EditImageOptions = {
  imageData: ArrayBuffer;
  imageContentType: string;
  prompt: string;
  maskData?: ArrayBuffer;
  extra?: Record<string, unknown>;
};

export type TestConnectionResult = {
  success: boolean;
  latencyMs?: number;
  error?: string;
};

export const UNSUPPORTED_FEATURE = "unsupported_feature" as const;

export interface ImageProvider {
  readonly slug: string;
  readonly name: string;

  isConfigured(): boolean;

  generateImage(options: GenerateImageOptions): Promise<GenerateImageResult>;

  /** Retorna UNSUPPORTED_FEATURE se o provider não suportar edição de imagem. */
  editImage(options: EditImageOptions): Promise<GenerateImageResult | typeof UNSUPPORTED_FEATURE>;

  getModels(): Promise<string[]>;

  testConnection(): Promise<TestConnectionResult>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(providerSlug: string) {
    super(`Provider "${providerSlug}" não está configurado (falta API key ou binding).`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class AllProvidersFailedError extends Error {
  constructor(public attempts: Array<{ provider: string; error: string }>) {
    super(`Todos os providers falharam: ${attempts.map((a) => `${a.provider} (${a.error})`).join("; ")}`);
    this.name = "AllProvidersFailedError";
  }
}
