// ============================================================================
// Prompt Engine
//
// Combina: YasminIdentity + UserRequest + ClothingDescription + SceneDescription
//          + CameraInstructions + QualityInstructions + NegativeInstructions
// em um FINAL_IMAGE_PROMPT.
//
// IMPORTANTE: este motor trabalha apenas com DESCRIÇÕES EM TEXTO (roupa,
// cenário, pose descrita em palavras). Ele não implementa — e não deve
// implementar — um modo que recebe a FOTO de outra pessoa e troca a
// identidade dela pela do modelo, preservando pose/corpo/enquadramento
// originais da foto de terceiro. Referências de roupa/cenário aqui servem
// apenas como texto descritivo fornecido pelo usuário, não como imagem de
// uma pessoa real a ser substituída.
// ============================================================================

import { parseJsonColumn } from "./db";

export type ModelIdentityRow = {
  age_range?: string | null;
  ethnicity_description?: string | null;
  skin_tone?: string | null;
  body_type?: string | null;
  face_description?: string | null;
  hair_description?: string | null;
  distinguishing_features?: string | null;
  negative_traits?: string | null; // JSON array
};

export type PromptEngineInput = {
  identity: ModelIdentityRow | null;
  userRequest: string;
  clothingDescription?: string;
  sceneDescription?: string;
  identityLock: "OFF" | "NORMAL" | "STRONG" | "MAXIMUM";
  format: string;
};

const BASE_QUALITY_INSTRUCTIONS =
  "high quality, sharp focus, natural lighting, realistic skin texture, professional photography";

const BASE_NEGATIVE_INSTRUCTIONS = [
  "different person",
  "different identity",
  "different facial structure",
  "square jaw",
  "facial distortion",
  "duplicated limbs",
  "malformed hands",
  "extra fingers",
  "missing fingers",
  "distorted eyes",
  "asymmetrical eyes",
  "incorrect anatomy",
  "watermark",
  "text",
  "logo",
  "AI artifacts",
  "excessive skin smoothing",
  "plastic skin",
  "unnatural proportions",
  "duplicated objects",
];

function buildIdentityDescription(identity: ModelIdentityRow | null): string {
  if (!identity) return "";
  const parts = [
    identity.age_range,
    identity.ethnicity_description,
    identity.skin_tone ? `${identity.skin_tone} skin` : null,
    identity.body_type,
    identity.face_description,
    identity.hair_description,
    identity.distinguishing_features,
  ].filter(Boolean);
  return parts.join(", ");
}

function identityLockInstructions(lock: PromptEngineInput["identityLock"]): string {
  switch (lock) {
    case "MAXIMUM":
      return "maintain exact facial consistency with reference, no alterations to facial structure or proportions";
    case "STRONG":
      return "strong facial consistency with reference";
    case "NORMAL":
      return "maintain general facial consistency with reference";
    case "OFF":
    default:
      return "";
  }
}

export function buildFinalPrompt(input: PromptEngineInput): { prompt: string; negativePrompt: string } {
  const identityDesc = buildIdentityDescription(input.identity);
  const lockInstructions = identityLockInstructions(input.identityLock);

  const segments = [
    identityDesc,
    input.userRequest,
    input.clothingDescription ? `wearing ${input.clothingDescription}` : null,
    input.sceneDescription ? `scene: ${input.sceneDescription}` : null,
    lockInstructions,
    BASE_QUALITY_INSTRUCTIONS,
  ].filter(Boolean);

  const customNegative = parseJsonColumn<string[]>(input.identity?.negative_traits, []);
  const negativeSegments = [...BASE_NEGATIVE_INSTRUCTIONS, ...customNegative];

  return {
    prompt: segments.join(", "),
    negativePrompt: negativeSegments.join(", "),
  };
}
