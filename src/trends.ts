import type { RunContext, TrendCandidate } from "./types";
import { discoverInstagram } from "./social/instagram";
import { applyTikTokSignals, discoverTikTokWatchItems, fetchCreativeCenterSignals } from "./social/tiktok";
import { detectImageType, readStreamLimited, sha256Hex } from "./utils";

export interface ReferenceImage {
  bytes: Uint8Array;
  contentType: string;
}

export async function discoverTrends(env: Env, context: RunContext): Promise<TrendCandidate[]> {
  const [instagram, tiktok, signals] = await Promise.all([
    discoverInstagram(
      context.sources,
      env.INSTAGRAM_USER_ID,
      env.INSTAGRAM_ACCESS_TOKEN,
      env.META_GRAPH_VERSION
    ),
    discoverTikTokWatchItems(context.sources),
    fetchCreativeCenterSignals(env.TIKTOK_TREND_FEED_URL)
  ]);

  return applyTikTokSignals([...instagram, ...tiktok], signals)
    .filter((candidate) => candidate.adultVerified)
    .filter((candidate) => candidate.declaredAge !== null && candidate.declaredAge >= 19 && candidate.declaredAge <= 23)
    .filter((candidate) => Boolean(candidate.imageUrl))
    .sort((left, right) => right.score - left.score)
    .slice(0, 50);
}

export async function downloadReference(candidate: TrendCandidate): Promise<ReferenceImage> {
  if (!candidate.imageUrl) throw new Error("Candidate has no visual reference");
  const url = new URL(candidate.imageUrl);
  if (url.protocol !== "https:") throw new Error("Reference must use HTTPS");
  const response = await fetch(url, {
    headers: { accept: "image/avif,image/webp,image/png,image/jpeg" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`Reference download failed: HTTP ${response.status}`);
  const bytes = await readStreamLimited(response.body, 4_000_000);
  const contentType = detectImageType(bytes);
  if (contentType === "application/octet-stream") throw new Error("Reference is not a supported image");
  return { bytes, contentType };
}

export async function storeReference(
  bucket: R2Bucket,
  runId: string,
  candidate: TrendCandidate,
  image: ReferenceImage
): Promise<string> {
  const digest = await sha256Hex(candidate.sourceUrl);
  const extension = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
  const key = `private/references/${runId}/${digest.slice(0, 20)}.${extension}`;
  await bucket.put(key, image.bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: "private, max-age=0" },
    customMetadata: { sourcePlatform: candidate.platform, sourceUrlHash: digest }
  });
  return key;
}
