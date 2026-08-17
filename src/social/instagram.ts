import type { InstagramMedia, TrendCandidate, WatchSource } from "../types";
import { clamp, readStreamLimited, safeNumber } from "../utils";

interface BusinessDiscoveryResponse {
  business_discovery?: {
    id?: string;
    username?: string;
    followers_count?: number;
    media?: { data?: InstagramMedia[] };
  };
  error?: { message?: string };
}

function cleanHandle(handle: string | null): string | null {
  if (!handle) return null;
  const cleaned = handle.trim().replace(/^@/u, "");
  return /^[A-Za-z0-9._]{1,30}$/u.test(cleaned) ? cleaned : null;
}

function scoreMedia(media: InstagramMedia, followers: number): number {
  const likes = safeNumber(media.like_count);
  const comments = safeNumber(media.comments_count);
  const engagement = followers > 0 ? (likes + comments * 4) / followers : 0;
  const ageHours = media.timestamp
    ? Math.max(0, (Date.now() - Date.parse(media.timestamp)) / 3_600_000)
    : 168;
  const freshness = Math.max(0, 1 - ageHours / (14 * 24));
  return clamp(Math.log1p(likes + comments * 4) * 7 + engagement * 250 + freshness * 22, 0, 100);
}

async function discoverOne(
  source: WatchSource,
  userId: string,
  accessToken: string,
  graphVersion: string
): Promise<TrendCandidate[]> {
  const handle = cleanHandle(source.handle);
  if (!handle) return [];

  const fields = [
    `business_discovery.username(${handle}){`,
    "id,username,followers_count,",
    "media.limit(12){id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count}",
    "}"
  ].join("");
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(userId)}`);
  url.searchParams.set("fields", fields);
  const response = await fetch(url, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000)
  });
  const bytes = await readStreamLimited(response.body, 1_500_000);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as BusinessDiscoveryResponse;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Instagram HTTP ${response.status}`);

  const profile = payload.business_discovery;
  const followers = safeNumber(profile?.followers_count);
  return (profile?.media?.data ?? [])
    .filter((media) => Boolean(media.media_url && media.permalink))
    .filter((media) => media.media_type === "IMAGE" || media.media_type === "CAROUSEL_ALBUM")
    .map((media) => ({
      id: `ig-${source.id}-${media.id}`,
      platform: "instagram" as const,
      creatorHandle: profile?.username ?? handle,
      sourceUrl: media.permalink as string,
      imageUrl: media.media_url as string,
      caption: media.caption ?? "",
      metrics: {
        likes: safeNumber(media.like_count),
        comments: safeNumber(media.comments_count),
        followers,
        sourceWeight: 1
      },
      publishedAt: media.timestamp ?? null,
      declaredAge: source.declared_age,
      adultVerified: Boolean(source.adult_verified_at),
      score: scoreMedia(media, followers),
      matchedSignals: []
    }));
}

export async function discoverInstagram(
  sources: WatchSource[],
  userId: string | undefined,
  accessToken: string | undefined,
  graphVersion: string
): Promise<TrendCandidate[]> {
  if (!userId || !accessToken) return [];
  const eligible = sources.filter((source) => source.platform === "instagram" && source.active === 1).slice(0, 30);
  const results = await Promise.allSettled(
    eligible.map((source) => discoverOne(source, userId, accessToken, graphVersion))
  );
  return results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
}
