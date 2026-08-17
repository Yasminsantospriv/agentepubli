CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watch_sources (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
  handle TEXT,
  external_url TEXT,
  declared_age INTEGER NOT NULL CHECK (declared_age BETWEEN 19 AND 23),
  adult_verified_at TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS watch_sources_active_idx
  ON watch_sources (active, platform);

CREATE TABLE IF NOT EXISTS identity_refs (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS identity_refs_active_idx
  ON identity_refs (active, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled', 'regenerate')),
  status TEXT NOT NULL,
  selected_candidate_id TEXT,
  selected_platform TEXT,
  selected_source_url TEXT,
  selected_reference_key TEXT,
  concept TEXT,
  brief_json TEXT,
  caption TEXT,
  moderation_json TEXT,
  error_message TEXT,
  decision TEXT CHECK (decision IN ('approved', 'rejected') OR decision IS NULL),
  decision_notes TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS runs_created_idx
  ON runs (created_at DESC);

CREATE INDEX IF NOT EXISTS runs_status_idx
  ON runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS trend_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  creator_handle TEXT,
  source_url TEXT NOT NULL,
  image_url TEXT,
  caption TEXT,
  metrics_json TEXT NOT NULL,
  published_at TEXT,
  score REAL NOT NULL,
  adult_verified INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS trend_candidates_run_score_idx
  ON trend_candidates (run_id, score DESC);

CREATE TABLE IF NOT EXISTS run_assets (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 10),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  audit_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, position)
);

CREATE INDEX IF NOT EXISTS run_assets_run_idx
  ON run_assets (run_id, position);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('brand_profile', '{"name":"Yasmin","age":19,"appearance":"adult woman, 19 years old, slim build with a narrow waist and slim arms, warm brown skin, subtly Arab-influenced facial features, softly rounded and narrow face, fine cheeks and chin, long brown hair","must_have":["same fictional identity across all images","natural Brazilian setting","photorealistic skin and hands","necklace spelling Yasmin only when visible"],"must_not_have":["square jaw","tattoos","glasses","lip piercing","hat","microphone","nudity","visible nipples or genitals","pornographic action","watermark","copied face from trend reference"]}'),
  ('caption_style', '{"language":"pt-BR","tone":"simples, carinhosa, confiante e natural","max_characters":160,"emoji_max":2,"hashtags_max":3}'),
  ('content_policy', '{"level":"sensual_platform_safe","allow":["fashion","swimwear","tasteful lingerie covered by platform rules","fitness","beach","lifestyle"],"deny":["nudity","transparent clothing exposing intimate areas","sexual acts","fetish content","minor or ambiguous age","copied face","watermarks and logos"]}');
