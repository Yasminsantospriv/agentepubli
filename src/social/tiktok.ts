import type { TrendCandidate, WatchSource } from "../types";
import { hashtags, readStreamLimited } from "../utils";

interface TikTokOEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

function isPublicTikTokUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.tiktok.com" || url.hostname === "tiktok.com" || url.hostname === "vm.tiktok.com");
  } catch {
    return false;
  }
}

async function oEmbedCandidate(source: WatchSource): Promise<TrendCandidate | null> {
  if (!isPublicTikTokUrl(source.external_url)) return null;
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", source.external_url);
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) return null;
  const bytes = await readStreamLimited(response.body, 600_000);
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as TikTokOEmbed;
  return {
    id: `tt-${source.id}`,
    platform: "tiktok",
    creatorHandle: payload.author_name ?? source.handle,
    sourceUrl: source.external_url,
    imageUrl: payload.thumbnail_url ?? null,
    caption: payload.title ?? "",
    metrics: { sourceWeight: 0.65 },
    publishedAt: null,
    declaredAge: source.declared_age,
    adultVerified: Boolean(source.adult_verified_at),
    score: 35,
    matchedSignals: []
  };
}

export async function discoverTikTokWatchItems(sources: WatchSource[]): Promise<TrendCandidate[]> {
  const eligible = sources.filter((source) => source.platform === "tiktok" && source.active === 1).slice(0, 20);
  const results = await Promise.allSettled(eligible.map(oEmbedCandidate));
  return results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

export async function fetchCreativeCenterSignals(feedUrl: string): Promise<string[]> {
  try {
    const url = new URL(feedUrl);
    if (url.protocol !== "https:" || url.hostname !== "ads.tiktok.com") return [];
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.7"
      },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) return [];
    const html = new TextDecoder().decode(await readStreamLimited(response.body, 3_000_000));
    const values: string[] = [];
    for (const match of html.matchAll(/"(?:hashtagName|hashtag_name)"\s*:\s*"([^"\\]{2,60})"/gu)) {
      values.push(match[1].toLowerCase());
      if (values.length >= 30) break;
    }
    return [...new Set(values)];
  } catch {
    return [];
  }
}

export function applyTikTokSignals(candidates: TrendCandidate[], signals: string[]): TrendCandidate[] {
  const signalSet = new Set(signals.map((signal) => signal.toLowerCase().replace(/^#/u, "")));
  return candidates.map((candidate) => {
    const matched = hashtags(candidate.caption).filter((tag) => signalSet.has(tag));
    return {
      ...candidate,
      matchedSignals: matched,
      score: Math.min(100, candidate.score + matched.length * 8)
    };
  });
}
