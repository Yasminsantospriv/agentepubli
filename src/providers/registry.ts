// ============================================================================
// Provider Registry — monta a lista de providers disponíveis e implementa
// o AI Provider Router (AUTOMATIC / MANUAL / FALLBACK)
// ============================================================================

import type { Bindings } from "../types";
import type { ImageProvider, GenerateImageOptions, GenerateImageResult } from "./types";
import { AllProvidersFailedError } from "./types";
import { CloudflareProvider } from "./cloudflare";
import { OpenAIProvider } from "./openai";
import { StubProvider } from "./stub";

export function buildProviderRegistry(env: Bindings): ImageProvider[] {
  return [
    new CloudflareProvider(env.AI, env.IMAGE_AI_MODEL),
    new OpenAIProvider(env.OPENAI_API_KEY),
    new StubProvider("gemini", "Google Gemini", "GOOGLE_API_KEY não configurada"),
    new StubProvider("replicate", "Replicate", "REPLICATE_API_TOKEN não configurada"),
    new StubProvider("fal", "FAL", "FAL_API_KEY não configurada"),
    new StubProvider("stability", "Stability AI", "STABILITY_API_KEY não configurada"),
  ];
}

export function getProvider(env: Bindings, slug: string): ImageProvider | undefined {
  return buildProviderRegistry(env).find((p) => p.slug === slug);
}

export function listConfiguredProviders(env: Bindings): ImageProvider[] {
  return buildProviderRegistry(env).filter((p) => p.isConfigured());
}

export type GenerationAttempt = { provider: string; error: string };

export async function generateWithFallback(
  providers: ImageProvider[],
  options: GenerateImageOptions
): Promise<{ result: GenerateImageResult; attempts: GenerationAttempt[] }> {
  const attempts: GenerationAttempt[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) {
      attempts.push({ provider: provider.slug, error: "not_configured" });
      continue;
    }
    try {
      const result = await provider.generateImage(options);
      return { result, attempts };
    } catch (err) {
      attempts.push({
        provider: provider.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new AllProvidersFailedError(attempts);
}

export function orderProvidersAutomatic(
  providers: ImageProvider[],
  freeFirst: boolean
): ImageProvider[] {
  const configured = providers.filter((p) => p.isConfigured());
  if (!freeFirst) return configured;
  return [...configured].sort((a, b) => {
    if (a.slug === "cloudflare") return -1;
    if (b.slug === "cloudflare") return 1;
    return 0;
  });
}
