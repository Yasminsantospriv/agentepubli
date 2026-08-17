-- ============================================================================
-- SEED — cria o registro inicial da Yasmin
-- Rode com: wrangler d1 execute yasmin-db --remote --file=./src/db/seed.sql
-- (ajuste as descrições de identidade antes de rodar, se quiser)
-- ============================================================================

INSERT INTO models (id, name, slug, active, created_at, updated_at)
VALUES ('yasmin-default-id', 'Yasmin', 'yasmin', 1, datetime('now'), datetime('now'));

INSERT INTO model_identity (
    id, model_id, age_range, ethnicity_description, skin_tone, body_type,
    face_description, hair_description, distinguishing_features,
    negative_traits, default_identity_lock, created_at, updated_at
) VALUES (
    'yasmin-identity-default-id',
    'yasmin-default-id',
    'adult woman, 21+',
    'Brazilian appearance',
    'tan',
    'slim, natural proportions',
    'delicate, slightly rounded face, soft cheeks, delicate jawline',
    'long brown hair',
    'small nose piercing',
    '["mouth piercing", "tattoos", "square jaw"]',
    'NORMAL',
    datetime('now'),
    datetime('now')
);
