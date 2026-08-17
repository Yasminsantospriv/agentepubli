import type { Bindings } from "../types";
import { dbAll, dbFirst, dbRun, parseJsonColumn } from "../lib/db";
import { newId, nowIso } from "../lib/response";
import { generateCaptionWithAi } from "../lib/text-ai";

type AutomationRule = {
  id: string;
  model_id: string | null;
  name: string;
  trigger_type: string;
  trigger_config: string | null;
  action_type: string;
  action_config: string | null;
  active: number;
};

export async function runAutomationRules(env: Bindings): Promise<{ processed: number; triggered: number; errors: number }> {
  const rules = await dbAll<AutomationRule>(env.DB, "SELECT * FROM automation_rules WHERE active = 1");
  let triggered = 0;
  let errors = 0;

  for (const rule of rules) {
    try {
      const didTrigger = await executeRule(env, rule);
      if (didTrigger) {
        triggered++;
        await dbRun(env.DB, "UPDATE automation_rules SET last_triggered_at = ?, updated_at = ? WHERE id = ?", nowIso(), nowIso(), rule.id);
      }
    } catch (err) {
      errors++;
      await dbRun(
        env.DB,
        `INSERT INTO activity_logs (id, model_id, event_type, description, metadata, created_at)
         VALUES (?, ?, 'AUTOMATION_FAILED', ?, ?, ?)`,
        newId(),
        rule.model_id,
        `Falha na automação: ${rule.name}`,
        JSON.stringify({ rule_id: rule.id, error: err instanceof Error ? err.message : String(err) }),
        nowIso()
      );
    }
  }

  return { processed: rules.length, triggered, errors };
}

async function executeRule(env: Bindings, rule: AutomationRule): Promise<boolean> {
  const triggerConfig = parseJsonColumn<Record<string, unknown>>(rule.trigger_config, {});
  const actionConfig = parseJsonColumn<Record<string, unknown>>(rule.action_config, {});

  if (rule.trigger_type === "trend_score_above" && rule.action_type === "suggest_content") {
    return handleTrendSuggestion(env, rule, triggerConfig, actionConfig);
  }

  if (rule.trigger_type === "asset_approved" && rule.action_type === "generate_caption") {
    return handleApprovedAssetCaption(env, rule, actionConfig);
  }

  if (rule.trigger_type === "content_approved" && rule.action_type === "create_story") {
    return handleApprovedContentStory(env, rule);
  }

  return false;
}

async function handleTrendSuggestion(
  env: Bindings,
  rule: AutomationRule,
  triggerConfig: Record<string, unknown>,
  _actionConfig: Record<string, unknown>
): Promise<boolean> {
  if (!rule.model_id) return false;
  const threshold = clampNumber(triggerConfig.threshold, 0, 100, 85);
  const trends = await dbAll<{ id: string; title: string; platform: string; score: number }>(
    env.DB,
    `SELECT id, title, platform, score FROM social_trends
     WHERE score >= ? AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY score DESC, detected_at DESC LIMIT 10`,
    threshold,
    nowIso()
  );

  let createdAny = false;
  for (const trend of trends) {
    const exists = await dbFirst<{ id: string }>(
      env.DB,
      "SELECT id FROM content_opportunities WHERE trend_id = ? AND model_id = ? LIMIT 1",
      trend.id,
      rule.model_id
    );
    if (exists) continue;

    await dbRun(
      env.DB,
      `INSERT INTO content_opportunities
       (id, trend_id, model_id, compatibility_score, suggested_concept, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'SUGGESTED', ?)`,
      newId(),
      trend.id,
      rule.model_id,
      trend.score,
      `Criar uma composição original para ${trend.platform} inspirada na tendência "${trend.title}", adaptada à identidade visual da Yasmin.`,
      nowIso()
    );
    createdAny = true;
  }

  if (createdAny) await logAutomation(env, rule, "AUTOMATION_TRIGGERED", "Oportunidades de tendência criadas");
  return createdAny;
}

async function handleApprovedAssetCaption(
  env: Bindings,
  rule: AutomationRule,
  actionConfig: Record<string, unknown>
): Promise<boolean> {
  if (!rule.model_id) return false;

  const asset = await dbFirst<{
    id: string;
    generation_id: string;
    user_request: string;
    created_at: string;
  }>(
    env.DB,
    `SELECT a.id, a.generation_id, j.user_request, a.created_at
     FROM generated_assets a
     JOIN generation_jobs j ON j.id = a.generation_id
     WHERE j.model_id = ? AND a.approval_status = 'APPROVED'
       AND NOT EXISTS (SELECT 1 FROM content_library c WHERE c.asset_id = a.id)
     ORDER BY a.created_at ASC LIMIT 1`,
    rule.model_id
  );
  if (!asset) return false;

  const platform = typeof actionConfig.platform === "string" ? actionConfig.platform : "instagram";
  const generated = await generateCaptionWithAi(env, {
    platform,
    context: asset.user_request,
    tone: typeof actionConfig.tone === "string" ? actionConfig.tone : undefined,
    language: typeof actionConfig.language === "string" ? actionConfig.language : "pt-BR",
  });

  await dbRun(
    env.DB,
    `INSERT INTO content_library
     (id, model_id, asset_id, content_type, caption, hashtags, status, created_at, updated_at)
     VALUES (?, ?, ?, 'post', ?, ?, 'DRAFT', ?, ?)`,
    newId(),
    rule.model_id,
    asset.id,
    generated.caption,
    JSON.stringify(generated.hashtags),
    nowIso(),
    nowIso()
  );
  await logAutomation(env, rule, "AUTOMATION_TRIGGERED", `Legenda criada automaticamente para asset ${asset.id}`);
  return true;
}

async function handleApprovedContentStory(env: Bindings, rule: AutomationRule): Promise<boolean> {
  if (!rule.model_id) return false;

  const source = await dbFirst<{ id: string; asset_id: string | null; caption: string | null; hashtags: string | null }>(
    env.DB,
    `SELECT id, asset_id, caption, hashtags FROM content_library c
     WHERE model_id = ? AND status = 'APPROVED' AND content_type <> 'story'
       AND NOT EXISTS (SELECT 1 FROM content_library child WHERE child.source_content_id = c.id AND child.content_type = 'story')
     ORDER BY updated_at ASC LIMIT 1`,
    rule.model_id
  );
  if (!source) return false;

  await dbRun(
    env.DB,
    `INSERT INTO content_library
     (id, model_id, asset_id, source_content_id, content_type, caption, hashtags, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'story', ?, ?, 'DRAFT', ?, ?)`,
    newId(),
    rule.model_id,
    source.asset_id,
    source.id,
    source.caption,
    source.hashtags,
    nowIso(),
    nowIso()
  );
  await logAutomation(env, rule, "AUTOMATION_TRIGGERED", `Versão Story criada a partir do conteúdo ${source.id}`);
  return true;
}

async function logAutomation(env: Bindings, rule: AutomationRule, eventType: string, description: string) {
  await dbRun(
    env.DB,
    `INSERT INTO activity_logs (id, model_id, event_type, description, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    newId(),
    rule.model_id,
    eventType,
    description,
    JSON.stringify({ rule_id: rule.id, rule_name: rule.name }),
    nowIso()
  );
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
}
