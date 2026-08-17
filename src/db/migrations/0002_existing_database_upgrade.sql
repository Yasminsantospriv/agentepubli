-- SOMENTE para bancos D1 que já foram criados com a versão anterior do schema.
-- Em uma instalação nova, NÃO rode este arquivo: src/db/schema.sql já contém a coluna.

ALTER TABLE content_library ADD COLUMN source_content_id TEXT REFERENCES content_library(id) ON DELETE SET NULL;
CREATE INDEX idx_content_library_source ON content_library(source_content_id);
