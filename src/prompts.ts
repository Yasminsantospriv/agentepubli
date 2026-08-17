import type { CreativeBrief, ImageAudit, TrendCandidate } from "./types";

export const CREATIVE_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "concept",
    "scene",
    "framing",
    "lighting",
    "wardrobe",
    "pose",
    "mood",
    "colorPalette",
    "viralHook",
    "originalityChange",
    "prohibitedCopiedDetails",
    "platformSafe",
    "safetyNotes"
  ],
  properties: {
    concept: { type: "string" },
    scene: { type: "string" },
    framing: { type: "string" },
    lighting: { type: "string" },
    wardrobe: { type: "string" },
    pose: { type: "string" },
    mood: { type: "string" },
    colorPalette: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
    viralHook: { type: "string" },
    originalityChange: { type: "string" },
    prohibitedCopiedDetails: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12 },
    platformSafe: { type: "boolean" },
    safetyNotes: { type: "string" }
  }
} as const;

export const IMAGE_AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "safePlatform",
    "appearsAdult",
    "identityConsistency",
    "hasTattoo",
    "hasGlasses",
    "hasLipPiercing",
    "nudity",
    "explicitContent",
    "watermarkOrLogo",
    "copiedReferenceIdentity",
    "anatomyQuality",
    "reason"
  ],
  properties: {
    safePlatform: { type: "boolean" },
    appearsAdult: { type: "boolean" },
    identityConsistency: { type: "number", minimum: 0, maximum: 1 },
    hasTattoo: { type: "boolean" },
    hasGlasses: { type: "boolean" },
    hasLipPiercing: { type: "boolean" },
    nudity: { type: "boolean" },
    explicitContent: { type: "boolean" },
    watermarkOrLogo: { type: "boolean" },
    copiedReferenceIdentity: { type: "boolean" },
    anatomyQuality: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" }
  }
} as const;

export const CAPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "hashtags"],
  properties: {
    caption: { type: "string", minLength: 10, maxLength: 180 },
    hashtags: { type: "array", items: { type: "string" }, maxItems: 3 }
  }
} as const;

export function buildTrendAnalysisPrompt(
  candidate: TrendCandidate,
  brandProfile: Record<string, unknown>,
  contentPolicy: Record<string, unknown>
): string {
  return [
    "Você é diretora criativa de conteúdo para Instagram no Brasil.",
    "Analise a referência apenas como sinal abstrato de tendência. Não copie o rosto, a identidade, tatuagens, marcas, texto, cenário distintivo ou composição exata da pessoa real.",
    "Extraia cenário genérico, enquadramento, luz, roupa, pose, clima e gancho visual. Em seguida mude pelo menos três elementos relevantes para criar uma fotografia original.",
    "A personagem final é a modelo fictícia Yasmin, adulta de 19 anos. O conteúdo deve ser sensual, mas seguro para Instagram: sem nudez, sem transparência íntima e sem ato sexual.",
    `Sinal: ${candidate.platform}; legenda: ${candidate.caption || "sem legenda"}; sinais cruzados: ${candidate.matchedSignals.join(", ") || "nenhum"}.`,
    `Identidade: ${JSON.stringify(brandProfile)}.`,
    `Política: ${JSON.stringify(contentPolicy)}.`,
    "Responda somente com JSON que corresponda ao esquema solicitado."
  ].join("\n");
}

export function buildImagePrompt(
  brief: CreativeBrief,
  brandProfile: Record<string, unknown>,
  position: number,
  strict = false
): string {
  const variation = [
    "cover image, medium full-body shot, strongest eye contact, clean negative space",
    "second carousel frame, candid three-quarter angle, slightly closer, natural movement",
    "third carousel frame, alternate relaxed pose and camera height, same outfit and location"
  ][Math.max(0, Math.min(2, position - 1))];

  return [
    "Create one new photorealistic vertical Instagram photograph in 4:5 format.",
    "Images 0, 1 and 2 show the same fictional adult woman named Yasmin. Preserve her face, long brown hair, warm brown skin, slim body proportions and adult appearance consistently. Do not preserve the reference images' poses, clothes or backgrounds.",
    `Brand identity: ${JSON.stringify(brandProfile)}.`,
    `Creative brief: ${JSON.stringify(brief)}.`,
    `Carousel variation: ${variation}.`,
    "Make the place feel naturally Brazilian, with believable phone-camera photography, realistic skin texture, accurate hands and coherent shadows.",
    "Yasmin is exactly 19 years old and visibly an adult. Tasteful, confident and platform-safe only.",
    "No tattoos anywhere. No glasses. No lip piercing. No hat. No microphone. No watermark, logo, UI, caption or written text. No nudity, no visible nipples or genitals, no transparent intimate clothing, no pornographic or fetish context.",
    "Do not reproduce the face, identity or unique details of any trend source. The result must be a new scene featuring only Yasmin.",
    strict ? "STRICT RETRY: prioritize adult appearance, covered intimate areas, identity consistency, clean anatomy and removal of every forbidden accessory above." : ""
  ].filter(Boolean).join("\n");
}

export function buildAuditPrompt(brandProfile: Record<string, unknown>): string {
  return [
    "Audit this generated social-media image. Be conservative.",
    "Confirm that the central subject clearly appears to be an adult, that the image is safe for an Instagram feed, and that there is no nudity or explicit sexual content.",
    "Check for tattoos, glasses, lip piercing, watermarks/logos, malformed anatomy and accidental resemblance to a different reference identity.",
    `Expected fictional identity: ${JSON.stringify(brandProfile)}.`,
    "Return only JSON matching the requested schema."
  ].join("\n");
}

export function buildCaptionPrompt(brief: CreativeBrief, captionStyle: Record<string, unknown>): string {
  return [
    "Escreva uma legenda curta para um carrossel de 3 fotos da Yasmin no Instagram.",
    `Briefing: ${JSON.stringify(brief)}.`,
    `Estilo: ${JSON.stringify(captionStyle)}.`,
    "Soar natural, como uma jovem brasileira de 19 anos. Não mencionar IA, tendência ou referência. Não ser explícita. Fazer no máximo uma pergunta simples. Usar no máximo 2 emojis e exatamente 3 hashtags específicas.",
    "Retorne somente JSON no formato solicitado."
  ].join("\n");
}

export function auditPasses(audit: ImageAudit): boolean {
  return audit.safePlatform
    && audit.appearsAdult
    && audit.identityConsistency >= 0.72
    && audit.anatomyQuality >= 0.72
    && !audit.hasTattoo
    && !audit.hasGlasses
    && !audit.hasLipPiercing
    && !audit.nudity
    && !audit.explicitContent
    && !audit.watermarkOrLogo
    && !audit.copiedReferenceIdentity;
}
