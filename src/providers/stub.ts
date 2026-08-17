// ============================================================================
// StubProvider — representa um provider cuja integração real ainda não foi
// implementada ou cuja API key ainda não foi configurada.
//
// Nunca finge estar conectado: generateImage sempre lança erro claro,
// e isConfigured() sempre retorna false. Isso evita "implementação falsa" —
// o card do provider no painel deve mostrar NOT_CONFIGURED / COMING SOON.
// ============================================================================

import type {
  ImageProvider,
  GenerateImageOptions,
  GenerateImageResult,
  EditImageOptions,
  TestConnectionResult,
} from "./types";
import { UNSUPPORTED_FEATURE } from "./types";

export class StubProvider implements ImageProvider {
  constructor(
    readonly slug: string,
    readonly name: string,
    private reason: string = "Integração ainda não implementada"
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async generateImage(_options: GenerateImageOptions): Promise<GenerateImageResult> {
    throw new Error(`${this.name}: ${this.reason}`);
  }

  async editImage(_options: EditImageOptions): Promise<GenerateImageResult | typeof UNSUPPORTED_FEATURE> {
    return UNSUPPORTED_FEATURE;
  }

  async getModels(): Promise<string[]> {
    return [];
  }

  async testConnection(): Promise<TestConnectionResult> {
    return { success: false, error: this.reason };
  }
}
