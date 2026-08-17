import type { Bindings } from "../types";

export type CaptionRequest = {
  platform: string;
  context: string;
  tone?: string;
  language?: string;
};

const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";

export async function generateCaptionWithAi(env: Bindings, input: CaptionRequest) {
  const model = env.TEXT_AI_MODEL || DEFAULT_TEXT_MODEL;
  const prompt = [
    "Você é um social media profissional.",
    `Crie uma legenda para ${input.platform || "Instagram"}.`,
    `Idioma: ${input.language || "pt-BR"}.`,
    `Tom: ${input.tone || "natural, confiante e elegante"}.`,
    `Contexto do conteúdo: ${input.context}.`,
    "Responda SOMENTE JSON válido no formato:",
    '{"caption":"texto da legenda","hashtags":["#tag1","#tag2"]}',
    "Use no máximo 12 hashtags relevantes e não invente métricas ou fatos.",
  ].join("\n");

  const result = await env.AI.run(model as keyof AiModels, {
    messages: [
      { role: "system", content: "Retorne apenas JSON válido, sem markdown." },
      { role: "user", content: prompt },
    ],
    max_tokens: 700,
  } as never);

  const text = extractTextResponse(result);
  const parsed = parseCaptionJson(text);
  return { ...parsed, model };
}

function extractTextResponse(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    if (typeof obj.result === "string") return obj.result;
  }
  throw new Error("Formato de resposta do modelo de texto não reconhecido");
}

function parseCaptionJson(text: string): { caption: string; hashtags: string[] } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as { caption?: unknown; hashtags?: unknown };
    if (typeof parsed.caption !== "string") throw new Error("caption ausente");
    const hashtags = Array.isArray(parsed.hashtags)
      ? parsed.hashtags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
      : [];
    return { caption: parsed.caption.trim(), hashtags };
  } catch {
    return { caption: cleaned, hashtags: [] };
  }
}
