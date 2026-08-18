import type { Bindings } from "../types";
import { dbAll, dbFirst, dbRun } from "../lib/db";
import { getSetting, setSetting } from "../lib/app-settings";
import { newId, nowIso } from "../lib/response";

type RawTrend = {
  title: string;
  traffic: string | null;
  publishedAt: string | null;
};

type ScoredTrend = {
  title: string;
  platform: "instagram" | "tiktok" | "threads" | "x" | "youtube";
  category: string;
  score: number;
  concept: string;
};

export type TrendScanResult = {
  skipped: boolean;
  source: string;
  fetched: number;
  selected: number;
  trends_saved: number;
  opportunities_created: number;
  ran_at: string;
  message?: string;
};

const SOURCE_NAME = "Google Trends Brasil";
const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const RSS_URLS = [
  "https://trends.google.com/trending/rss?geo=BR",
  "https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR",
];

export async function runTrendScanner(env: Bindings, options: { force?: boolean } = {}): Promise<TrendScanResult> {
  const enabled = await getSetting<boolean>(env.DB, "trend_scanner_enabled", true);
  const intervalMinutes = await getSetting<number>(env.DB, "trend_scanner_interval_minutes", DEFAULT_INTERVAL_MINUTES);
  const lastRun = await getSetting<string | null>(env.DB, "trend_scanner_last_run", null);

  if (!enabled && !options.force) {
    return emptyResult(true, "Scanner automático desativado.");
  }

  if (!options.force && lastRun && !isDue(lastRun, intervalMinutes)) {
    return emptyResult(true, "Ainda não chegou o horário da próxima busca.");
  }

  const ranAt = nowIso();
  try {
    const raw = await fetchGoogleTrends();
    const scored = await scoreTrendsWithAi(env, raw.slice(0, 30));
    const model = await dbFirst<{ id: string }>(env.DB, "SELECT id FROM models WHERE slug = 'yasmin' AND active = 1");

    let trendsSaved = 0;
    let opportunitiesCreated = 0;

    for (const trend of scored.filter((item) => item.score >= 60).slice(0, 12)) {
      const existing = await dbFirst<{ id: string }>(
        env.DB,
        `SELECT id FROM social_trends
         WHERE lower(title) = lower(?) AND source = ?
           AND detected_at > datetime('now', '-2 days')
         ORDER BY detected_at DESC LIMIT 1`,
        trend.title,
        SOURCE_NAME
      );

      let trendId = existing?.id;
      if (!trendId) {
        trendId = newId();
        const expiresAt = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
        await dbRun(
          env.DB,
          `INSERT INTO social_trends (id, platform, title, category, score, source, detected_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          trendId,
          trend.platform,
          trend.title,
          trend.category,
          Math.round(Math.max(0, Math.min(100, trend.score))),
          SOURCE_NAME,
          ranAt,
          expiresAt
        );
        trendsSaved++;
      }

      if (model && trend.score >= 70) {
        const opportunityExists = await dbFirst<{ id: string }>(
          env.DB,
          "SELECT id FROM content_opportunities WHERE trend_id = ? AND model_id = ? LIMIT 1",
          trendId,
          model.id
        );
        if (!opportunityExists) {
          await dbRun(
            env.DB,
            `INSERT INTO content_opportunities
             (id, trend_id, model_id, compatibility_score, suggested_concept, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'SUGGESTED', ?)`,
            newId(),
            trendId,
            model.id,
            Math.round(trend.score),
            trend.concept,
            ranAt
          );
          opportunitiesCreated++;
        }
      }
    }

    const result: TrendScanResult = {
      skipped: false,
      source: SOURCE_NAME,
      fetched: raw.length,
      selected: scored.length,
      trends_saved: trendsSaved,
      opportunities_created: opportunitiesCreated,
      ran_at: ranAt,
    };

    await Promise.all([
      setSetting(env.DB, "trend_scanner_enabled", true),
      setSetting(env.DB, "trend_scanner_interval_minutes", intervalMinutes),
      setSetting(env.DB, "trend_scanner_last_run", ranAt),
      setSetting(env.DB, "trend_scanner_last_result", result),
    ]);

    await dbRun(
      env.DB,
      `INSERT INTO activity_logs (id, model_id, event_type, description, metadata, created_at)
       VALUES (?, ?, 'TREND_SCAN', ?, ?, ?)`,
      newId(),
      model?.id ?? null,
      `Scanner de tendências: ${trendsSaved} novas tendências e ${opportunitiesCreated} oportunidades`,
      JSON.stringify(result),
      ranAt
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TrendScanResult = {
      skipped: false,
      source: SOURCE_NAME,
      fetched: 0,
      selected: 0,
      trends_saved: 0,
      opportunities_created: 0,
      ran_at: ranAt,
      message,
    };
    await Promise.all([
      setSetting(env.DB, "trend_scanner_last_run", ranAt),
      setSetting(env.DB, "trend_scanner_last_result", result),
    ]);
    return result;
  }
}

export async function getTrendScannerStatus(env: Bindings) {
  const [enabled, intervalMinutes, lastRun, lastResult] = await Promise.all([
    getSetting<boolean>(env.DB, "trend_scanner_enabled", true),
    getSetting<number>(env.DB, "trend_scanner_interval_minutes", DEFAULT_INTERVAL_MINUTES),
    getSetting<string | null>(env.DB, "trend_scanner_last_run", null),
    getSetting<TrendScanResult | null>(env.DB, "trend_scanner_last_result", null),
  ]);
  return {
    enabled,
    interval_minutes: intervalMinutes,
    last_run: lastRun,
    last_result: lastResult,
    source: SOURCE_NAME,
  };
}

async function fetchGoogleTrends(): Promise<RawTrend[]> {
  const errors: string[] = [];
  for (const url of RSS_URLS) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "YasminAIStudio/1.0",
          "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        },
      });
      if (!response.ok) {
        errors.push(`${response.status} em ${url}`);
        continue;
      }
      const xml = await response.text();
      const parsed = parseRss(xml);
      if (parsed.length) return parsed;
      errors.push(`RSS vazio em ${url}`);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Não foi possível ler o Google Trends: ${errors.join(" | ")}`);
}

function parseRss(xml: string): RawTrend[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => ({
    title: decodeXml(readTag(item, "title") || "").trim(),
    traffic: decodeXml(readTag(item, "ht:approx_traffic") || readTag(item, "approx_traffic") || "").trim() || null,
    publishedAt: decodeXml(readTag(item, "pubDate") || "").trim() || null,
  })).filter((item) => item.title.length > 1);
}

function readTag(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  if (!match) return null;
  return match[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

async function scoreTrendsWithAi(env: Bindings, trends: RawTrend[]): Promise<ScoredTrend[]> {
  if (!trends.length) return [];
  const model = env.TEXT_AI_MODEL || DEFAULT_TEXT_MODEL;
  const compact = trends.map((t, index) => ({ id: index, title: t.title, traffic: t.traffic }));
  const prompt = [
    "Você é o scanner de tendências do Yasmin AI Studio, uma ferramenta para planejamento de conteúdo de uma influenciadora virtual adulta.",
    "Analise as tendências do Google Trends Brasil e selecione apenas oportunidades úteis para conteúdo de lifestyle, moda, beleza, música, entretenimento, viagens, cultura pop, estética, memes leves e comportamento digital.",
    "Ignore política partidária, crimes, tragédias, acidentes, morte, desastres, jogos de azar, resultados esportivos puros e temas que não tenham adaptação criativa clara.",
    "Não copie a identidade de pessoas reais. Transforme o assunto apenas em uma ideia original de conteúdo.",
    "Para cada item selecionado, escolha a plataforma mais adequada entre instagram, tiktok, threads, x, youtube.",
    "Dê score 0-100 considerando atualidade, potencial visual, capacidade de adaptação para Yasmin e utilidade para criação de conteúdo.",
    "Retorne no máximo 12 itens e SOMENTE JSON válido neste formato:",
    '[{"title":"título exato recebido","platform":"instagram","category":"lifestyle","score":82,"concept":"conceito original em português"}]',
    `Tendências: ${JSON.stringify(compact)}`,
  ].join("\n");

  try {
    const response = await env.AI.run(model as keyof AiModels, {
      messages: [
        { role: "system", content: "Responda somente JSON válido, sem markdown." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1800,
    } as never);
    const text = extractAiText(response);
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (!Array.isArray(parsed)) throw new Error("Formato inválido");
    return parsed
      .filter((item) => item && typeof item.title === "string" && typeof item.concept === "string")
      .map((item) => ({
        title: String(item.title).trim(),
        platform: validPlatform(item.platform),
        category: String(item.category || "tendência").slice(0, 80),
        score: clampScore(item.score),
        concept: String(item.concept).trim().slice(0, 1000),
      }))
      .filter((item) => item.title && item.concept);
  } catch {
    return fallbackScore(trends);
  }
}

function fallbackScore(trends: RawTrend[]): ScoredTrend[] {
  const blocked = /\b(futebol|x\s+[a-z]|placar|lotof[aá]cil|mega.?sena|presidente|stf|pol[ií]tica|morte|morreu|acidente|assassin|crime|pris[aã]o)\b/i;
  return trends
    .filter((trend) => !blocked.test(trend.title))
    .slice(0, 8)
    .map((trend) => ({
      title: trend.title,
      platform: "instagram" as const,
      category: "tendência",
      score: trafficScore(trend.traffic),
      concept: `Criar um conteúdo original da Yasmin inspirado no assunto “${trend.title}”, usando apenas o tema geral e uma abordagem visual própria.`,
    }));
}

function trafficScore(traffic: string | null): number {
  if (!traffic) return 65;
  const normalized = traffic.toLowerCase().replace(/\s/g, "");
  if (/1m|1mi|1milh[aã]o/.test(normalized)) return 90;
  if (/500k|500mil/.test(normalized)) return 86;
  if (/200k|200mil/.test(normalized)) return 82;
  if (/100k|100mil/.test(normalized)) return 78;
  if (/50k|50mil/.test(normalized)) return 74;
  if (/20k|20mil/.test(normalized)) return 70;
  return 66;
}

function extractAiText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const obj = result as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    if (typeof obj.result === "string") return obj.result;
  }
  throw new Error("Resposta do modelo não reconhecida");
}

function validPlatform(value: unknown): ScoredTrend["platform"] {
  const allowed = new Set(["instagram", "tiktok", "threads", "x", "youtube"]);
  const normalized = String(value || "instagram").toLowerCase();
  return (allowed.has(normalized) ? normalized : "instagram") as ScoredTrend["platform"];
}

function clampScore(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 65;
  return Math.round(Math.min(100, Math.max(0, num)));
}

function isDue(lastRun: string, intervalMinutes: number): boolean {
  const last = new Date(lastRun).getTime();
  if (!Number.isFinite(last)) return true;
  const interval = Math.max(15, Number(intervalMinutes) || DEFAULT_INTERVAL_MINUTES) * 60_000;
  return Date.now() - last >= interval;
}

function emptyResult(skipped: boolean, message: string): TrendScanResult {
  return {
    skipped,
    source: SOURCE_NAME,
    fetched: 0,
    selected: 0,
    trends_saved: 0,
    opportunities_created: 0,
    ran_at: nowIso(),
    message,
  };
}
