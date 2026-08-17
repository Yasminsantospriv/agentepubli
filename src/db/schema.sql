-- ============================================================================
-- YASMIN AI — CONTENT & AUTOMATION STUDIO
-- Schema do banco de dados (Cloudflare D1 / SQLite)
-- ============================================================================
-- Convenções:
--   - IDs em TEXT (uuid) para compatibilidade com geração no Worker (crypto.randomUUID())
--   - Timestamps em TEXT (ISO 8601), gerados pela aplicação ou por DEFAULT (strftime)
--   - Campos JSON armazenados como TEXT (D1/SQLite não tem tipo JSON nativo)
--   - Arquivos (imagens) NUNCA são armazenados no banco — apenas a storage_key do R2
--   - Segredos (API keys) NUNCA são armazenados aqui — apenas se estão configurados
-- ============================================================================


-- ============================================================================
-- 1. USERS — autenticação administrativa do painel
-- ============================================================================
CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'editor', 'viewer')),
    active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_login_at TEXT
);


-- ============================================================================
-- 2. MODELS — modelos virtuais (Yasmin, e futuras)
-- ============================================================================
CREATE TABLE models (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,       -- ex: 'yasmin'
    active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    avatar_key TEXT,                        -- storage_key da imagem de capa/avatar
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_models_slug ON models(slug);


-- ============================================================================
-- 3. MODEL_IDENTITY — ficha de identidade visual protegida de cada modelo
-- ============================================================================
CREATE TABLE model_identity (
    id                    TEXT PRIMARY KEY,
    model_id              TEXT NOT NULL UNIQUE REFERENCES models(id) ON DELETE CASCADE,

    -- Descrição estruturada (usada para montar o prompt final)
    age_range             TEXT,             -- ex: "young adult"
    ethnicity_description TEXT,
    skin_tone             TEXT,
    body_type             TEXT,
    face_description      TEXT,
    hair_description       TEXT,
    distinguishing_features TEXT,            -- ex: "small nose piercing"

    -- Regras de restrição (o que NUNCA deve aparecer)
    negative_traits        TEXT,             -- JSON array: ["mouth piercing", "tattoos", ...]

    -- Configuração padrão
    default_identity_lock TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (default_identity_lock IN ('OFF', 'NORMAL', 'STRONG', 'MAXIMUM')),

    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);


-- ============================================================================
-- 4. MODEL_REFERENCES — vault de referências visuais (próprias do modelo)
-- ============================================================================
CREATE TABLE model_references (
    id             TEXT PRIMARY KEY,
    model_id       TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,

    storage_key    TEXT NOT NULL,            -- caminho no R2
    reference_type TEXT NOT NULL CHECK (reference_type IN
                     ('FACE', 'BODY', 'HAIR', 'MASTER', 'STYLE', 'TEMPORARY')),

    -- Prioridade/peso na construção do prompt
    priority       INTEGER NOT NULL DEFAULT 5,   -- 0-10
    weight         REAL NOT NULL DEFAULT 1.0,

    -- Flags de master reference
    is_master_face  INTEGER NOT NULL DEFAULT 0 CHECK (is_master_face IN (0, 1)),
    is_master_body  INTEGER NOT NULL DEFAULT 0 CHECK (is_master_body IN (0, 1)),
    is_master_full  INTEGER NOT NULL DEFAULT 0 CHECK (is_master_full IN (0, 1)),

    active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    description    TEXT,

    -- Origem: upload direto vs. gerado pelo próprio sistema e promovido a referência
    source_type    TEXT NOT NULL DEFAULT 'UPLOAD' CHECK (source_type IN ('UPLOAD', 'GENERATED')),
    source_asset_id TEXT REFERENCES generated_assets(id) ON DELETE SET NULL,

    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_model_references_model ON model_references(model_id, reference_type, active);
CREATE INDEX idx_model_references_master ON model_references(model_id, is_master_face, is_master_body, is_master_full);


-- ============================================================================
-- 5. AI_PROVIDERS — provedores de geração de imagem configurados
-- ============================================================================
CREATE TABLE ai_providers (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,             -- ex: "OpenAI"
    slug                TEXT NOT NULL UNIQUE,       -- ex: "openai"
    provider_type       TEXT NOT NULL,              -- ex: "image_generation"

    -- Nunca armazenar a key aqui — apenas se está configurada (via Secrets do Worker)
    api_key_configured  INTEGER NOT NULL DEFAULT 0 CHECK (api_key_configured IN (0, 1)),

    default_model       TEXT,                       -- ex: "gpt-image-1"
    priority             INTEGER NOT NULL DEFAULT 5, -- usado no modo AUTOMATIC/FALLBACK
    status               TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
                          CHECK (status IN ('NOT_CONFIGURED', 'ONLINE', 'OFFLINE', 'ERROR')),
    active               INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),

    config               TEXT,                       -- JSON: opções específicas do provedor
    last_tested_at        TEXT,
    last_test_result      TEXT,                       -- JSON: { success, latency_ms, error }

    -- Controle de custo
    daily_generation_limit   INTEGER,
    monthly_generation_limit INTEGER,
    budget_limit_cents       INTEGER,

    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_ai_providers_active ON ai_providers(active, priority);


-- ============================================================================
-- 6. PROMPTS — templates de prompt reutilizáveis/aprovados
-- ============================================================================
CREATE TABLE prompts (
    id           TEXT PRIMARY KEY,
    model_id     TEXT REFERENCES models(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    category     TEXT,                       -- ex: "profile_photo", "story", "post"
    template     TEXT NOT NULL,               -- texto do prompt com placeholders
    negative_template TEXT,

    approved     INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
    usage_count  INTEGER NOT NULL DEFAULT 0,

    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_prompts_model ON prompts(model_id, category);


-- ============================================================================
-- 7. GENERATION_JOBS — cada solicitação de geração de imagem
-- ============================================================================
CREATE TABLE generation_jobs (
    id               TEXT PRIMARY KEY,
    model_id         TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    provider_id      TEXT REFERENCES ai_providers(id) ON DELETE SET NULL,
    prompt_id        TEXT REFERENCES prompts(id) ON DELETE SET NULL,

    provider_model_name TEXT,                 -- ex: "dall-e-3", modelo específico usado

    user_request     TEXT NOT NULL,            -- texto original digitado pelo usuário
    final_prompt     TEXT,                     -- prompt final montado pelo Prompt Engine
    negative_prompt  TEXT,

    format           TEXT NOT NULL DEFAULT '1:1'
                      CHECK (format IN ('1:1', '4:5', '9:16', 'landscape', 'custom')),
    quantity         INTEGER NOT NULL DEFAULT 1,
    identity_lock    TEXT NOT NULL DEFAULT 'NORMAL'
                      CHECK (identity_lock IN ('OFF', 'NORMAL', 'STRONG', 'MAXIMUM')),

    -- Referências usadas nesta geração (snapshot, não FK — preserva histórico
    -- mesmo se a referência for depois desativada/excluída)
    references_used  TEXT,                     -- JSON array de model_reference ids + tipos

    settings         TEXT,                     -- JSON: parâmetros extras enviados ao provider

    status           TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')),
    error            TEXT,

    -- Rastreamento de fallback entre providers
    attempted_providers TEXT,                  -- JSON array de provider_ids tentados em ordem

    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at       TEXT,
    completed_at     TEXT
);

CREATE INDEX idx_generation_jobs_model ON generation_jobs(model_id, status, created_at);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);


-- ============================================================================
-- 8. GENERATED_ASSETS — imagens resultantes de uma geração
-- ============================================================================
CREATE TABLE generated_assets (
    id             TEXT PRIMARY KEY,
    generation_id  TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,

    storage_key    TEXT NOT NULL,              -- caminho no R2
    provider_slug  TEXT,                       -- snapshot do provider usado
    width          INTEGER,
    height         INTEGER,
    format         TEXT DEFAULT 'jpg',

    -- Curadoria/aprovação
    approval_status TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    rejection_reason TEXT,                     -- ex: "rosto", "mãos", "identidade"...

    favorite        INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),

    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_generated_assets_generation ON generated_assets(generation_id);
CREATE INDEX idx_generated_assets_approval ON generated_assets(approval_status, favorite);


-- ============================================================================
-- 9. CONTENT_LIBRARY — conteúdo pronto (posts, stories, reels) a partir de assets
-- ============================================================================
CREATE TABLE content_library (
    id            TEXT PRIMARY KEY,
    model_id      TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    asset_id      TEXT REFERENCES generated_assets(id) ON DELETE SET NULL,
    source_content_id TEXT REFERENCES content_library(id) ON DELETE SET NULL,

    content_type  TEXT NOT NULL CHECK (content_type IN ('post', 'story', 'reel', 'carousel', 'reference')),
    caption       TEXT,
    hashtags      TEXT,                        -- JSON array

    status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'READY', 'APPROVED', 'PUBLISHED', 'ARCHIVED')),

    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_content_library_model ON content_library(model_id, status);
CREATE INDEX idx_content_library_type ON content_library(content_type);
CREATE INDEX idx_content_library_source ON content_library(source_content_id);


-- ============================================================================
-- 10. CONTENT_PLANS — agendamento/planejamento de publicação
-- ============================================================================
CREATE TABLE content_plans (
    id            TEXT PRIMARY KEY,
    content_id    TEXT NOT NULL REFERENCES content_library(id) ON DELETE CASCADE,

    platform      TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'threads', 'x', 'youtube')),
    scheduled_at  TEXT NOT NULL,               -- data/hora planejada
    published_at  TEXT,                        -- preenchido quando efetivamente publicado

    status        TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'READY', 'APPROVED', 'PUBLISHED', 'CANCELLED')),

    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_content_plans_schedule ON content_plans(scheduled_at, status);
CREATE INDEX idx_content_plans_content ON content_plans(content_id);


-- ============================================================================
-- 11. SOCIAL_TRENDS — tendências detectadas (fonte externa futura)
-- ============================================================================
CREATE TABLE social_trends (
    id           TEXT PRIMARY KEY,
    platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'threads', 'x', 'youtube')),
    title        TEXT NOT NULL,
    category     TEXT,
    score        INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    source       TEXT,                         -- de onde veio a tendência

    detected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at   TEXT
);

CREATE INDEX idx_social_trends_score ON social_trends(score DESC, detected_at DESC);
CREATE INDEX idx_social_trends_platform ON social_trends(platform, expires_at);


-- ============================================================================
-- 12. CONTENT_OPPORTUNITIES — tendências convertidas em sugestões de conteúdo
-- ============================================================================
CREATE TABLE content_opportunities (
    id                  TEXT PRIMARY KEY,
    trend_id            TEXT NOT NULL REFERENCES social_trends(id) ON DELETE CASCADE,
    model_id            TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,

    compatibility_score INTEGER CHECK (compatibility_score BETWEEN 0 AND 100),
    suggested_concept   TEXT,
    suggested_prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL,

    status              TEXT NOT NULL DEFAULT 'SUGGESTED'
                         CHECK (status IN ('SUGGESTED', 'ACCEPTED', 'DISMISSED', 'CONVERTED')),

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_content_opportunities_model ON content_opportunities(model_id, status);


-- ============================================================================
-- 13. AUTOMATION_RULES — regras de automação (gatilho → ação)
-- ============================================================================
CREATE TABLE automation_rules (
    id               TEXT PRIMARY KEY,
    model_id         TEXT REFERENCES models(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,

    trigger_type     TEXT NOT NULL,             -- ex: "trend_score_above", "asset_approved"
    trigger_config   TEXT,                       -- JSON: { "threshold": 85 }

    action_type      TEXT NOT NULL,              -- ex: "suggest_content", "generate_caption"
    action_config    TEXT,                       -- JSON

    active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    last_triggered_at TEXT,

    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_automation_rules_active ON automation_rules(active, trigger_type);


-- ============================================================================
-- 14. SETTINGS — configurações gerais do sistema (chave/valor)
-- ============================================================================
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,                            -- JSON ou texto simples
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);


-- ============================================================================
-- 15. ACTIVITY_LOGS — trilha de auditoria de eventos do sistema
-- ============================================================================
CREATE TABLE activity_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
    model_id    TEXT REFERENCES models(id) ON DELETE SET NULL,

    event_type  TEXT NOT NULL,                  -- ex: "GENERATION_STARTED", "REFERENCE_UPLOAD"
    description TEXT,
    metadata    TEXT,                            -- JSON, nunca contendo segredos

    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_activity_logs_event ON activity_logs(event_type, created_at DESC);
CREATE INDEX idx_activity_logs_model ON activity_logs(model_id, created_at DESC);


-- ============================================================================
-- 16. LEARNING_SIGNALS — feedback de aprovação/rejeição para ajustar prompts futuros
-- ============================================================================
CREATE TABLE learning_signals (
    id          TEXT PRIMARY KEY,
    asset_id    TEXT NOT NULL REFERENCES generated_assets(id) ON DELETE CASCADE,
    model_id    TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,

    signal      TEXT NOT NULL CHECK (signal IN ('POSITIVE', 'NEGATIVE')),
    reason      TEXT,                            -- ex: "rosto", "mãos", "roupa", "iluminação"

    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_learning_signals_model ON learning_signals(model_id, signal);
