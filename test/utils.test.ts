import { describe, expect, it } from "vitest";
import { auditPasses } from "../src/prompts";
import { signAsset, verifyAssetSignature } from "../src/security";
import type { ImageAudit } from "../src/types";
import { detectImageType, extractJson, imageDimensions } from "../src/utils";

describe("image validation", () => {
  it("reads PNG dimensions from the IHDR header", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, 512);
    view.setUint32(20, 384);
    expect(detectImageType(bytes)).toBe("image/png");
    expect(imageDimensions(bytes, "image/png")).toEqual({ width: 512, height: 384 });
  });
});

describe("structured AI parsing", () => {
  it("extracts JSON surrounded by model prose", () => {
    expect(extractJson<{ ok: boolean }>("result:\n{\"ok\":true}\nend")).toEqual({ ok: true });
  });
});

describe("asset signatures", () => {
  it("accepts the signed key and rejects a changed key", async () => {
    const expires = Math.floor(Date.now() / 1_000) + 600;
    const secret = "test-secret-with-enough-entropy-for-unit-tests";
    const signature = await signAsset("private/generated/run/1.png", expires, secret);
    await expect(verifyAssetSignature("private/generated/run/1.png", expires, signature, secret)).resolves.toBe(true);
    await expect(verifyAssetSignature("private/generated/run/2.png", expires, signature, secret)).resolves.toBe(false);
  });
});

describe("image audit gate", () => {
  const passing: ImageAudit = {
    safePlatform: true,
    appearsAdult: true,
    identityConsistency: 0.9,
    hasTattoo: false,
    hasGlasses: false,
    hasLipPiercing: false,
    nudity: false,
    explicitContent: false,
    watermarkOrLogo: false,
    copiedReferenceIdentity: false,
    anatomyQuality: 0.9,
    reason: "ok"
  };

  it("passes a compliant image and blocks forbidden details", () => {
    expect(auditPasses(passing)).toBe(true);
    expect(auditPasses({ ...passing, hasTattoo: true })).toBe(false);
    expect(auditPasses({ ...passing, appearsAdult: false })).toBe(false);
    expect(auditPasses({ ...passing, identityConsistency: 0.5 })).toBe(false);
  });
});
