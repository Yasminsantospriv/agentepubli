# Changelog

## 2026-08-17 — revisão 0.2.0

### Added

- Autenticação administrativa PBKDF2 + JWT
- `POST /auth/login`
- Rate limiting KV em geração, edição e captions
- Social Agent (`POST /models/:slug/caption`)
- Cron Trigger a cada 15 minutos
- Executor real de automações e endpoint manual `POST /automations/run`
- Edição de imagem na OpenAI via `/images/edits`
- Script `npm run hash:password`
- `DEPLOY_CHECKLIST.md`
- Migração opcional para banco já existente

### Changed

- `/health` não reporta mais frontend inexistente como ONLINE
- Seed da Yasmin atualizado para adulta 21+
- `content_library` ganhou `source_content_id` para derivações como Story

### Fixed

- Eliminado falso estado de suporte de edição de imagem
- Corrigido narrowing de tipo no resultado de `editImage`

## 2026-08-17 — versão inicial

### Added

- Schema D1 inicial
- API Hono
- Reference Vault
- geração de imagens
- Provider Router
- R2
- biblioteca/planner/trends/automations CRUD
