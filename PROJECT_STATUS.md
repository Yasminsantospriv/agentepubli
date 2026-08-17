# PROJECT STATUS

## Última atualização

2026-08-17 — Backend revisado: segurança, Social Agent, rate limiting, automações agendadas e edição de imagem implementados.

## Arquitetura atual

Cloudflare Worker (Hono) + D1 + R2 + KV + Workers AI. Providers de imagem com interface comum e fallback automático. O Worker também possui handler `scheduled()` para executar automações por Cron Trigger.

## Concluído

- Schema D1 completo e validado com SQLite
- Seed inicial da Yasmin (adulta 21+)
- API REST para modelos, identidade, Reference Vault, geração, biblioteca, planner, trends, automações, settings, dashboard e health
- Providers de geração: Cloudflare Workers AI e OpenAI
- Edição de imagem real via OpenAI Images Edits; Cloudflare continua honesto como `unsupported_feature` até existir resize das referências para o limite do FLUX.2
- Provider Router com fallback e FREE-FIRST
- R2 para referências e imagens geradas
- Autenticação administrativa com PBKDF2 + JWT
- Script `npm run hash:password` para gerar `ADMIN_PASSWORD_HASH`
- Rate limiting via KV em rotas de geração, edição e captions
- Social Agent: `POST /models/:slug/caption` usando Workers AI para legenda + hashtags
- Cron Trigger a cada 15 minutos
- Executor de automações com suporte inicial a:
  - `trend_score_above` → `suggest_content`
  - `asset_approved` → `generate_caption`
  - `content_approved` → `create_story`
- Execução manual de automações por `POST /automations/run`
- `/health` corrigido: frontend aparece `NOT_CONFIGURED` enquanto não existir

## Em andamento / não implementado ainda

- Frontend/painel visual
- Integrações reais de Gemini, Replicate, FAL e Stability (continuam stubs honestos)
- Publicação direta em Instagram/TikTok/Threads/X/YouTube
- Análise automática externa de tendências (API aceita tendências, mas a coleta externa ainda não existe)

## Próximas tarefas

1. Construir frontend responsivo consumindo esta API
2. Criar tela de login e armazenar token com segurança
3. Criar Dashboard/Create/Library/References/Trends/Planner/Automations/Settings
4. Adicionar upload/seleção de referências ao fluxo visual
5. Integrar provedores extras apenas quando houver necessidade/chaves

## Pendências externas

- Criar D1 e inserir `database_id` em `wrangler.jsonc`
- Criar bucket R2
- Criar namespace KV e inserir o ID em `wrangler.jsonc`
- Configurar `ADMIN_PASSWORD_HASH`
- Configurar `JWT_SECRET`
- `OPENAI_API_KEY` é opcional

## Validação realizada nesta revisão

- `src/db/schema.sql` executado em SQLite em memória: OK
- `src/db/seed.sql` executado sobre o schema: OK
- Verificação estática encontrou e corrigiu um problema de narrowing de tipo no fluxo de edição
- `npm install` não pôde ser concluído neste ambiente por timeout de acesso externo; por isso o `npm run typecheck` completo deve ser executado após instalar dependências no ambiente do usuário/GitHub/Cloudflare

## Decisões técnicas

- IDs UUID em TEXT
- R2 guarda binários; D1 guarda metadados
- Secrets nunca ficam no frontend/repositório
- Assets ficam atrás da autenticação do Worker
- Automação cria rascunhos/oportunidades e evita publicação externa irreversível
- Reference Vault define a identidade da própria modelo; referências externas não substituem identidades

## Arquivos importantes

- `src/index.ts` — entrada HTTP + Cron Trigger
- `src/lib/auth.ts` — JWT/PBKDF2
- `src/lib/rate-limit.ts` — limite via KV
- `src/lib/text-ai.ts` — legendas/hashtags
- `src/services/automation-runner.ts` — execução de automações
- `src/providers/cloudflare.ts` — geração + edição Cloudflare
- `src/providers/openai.ts` — geração + edição OpenAI
- `src/routes/generation.ts` — geração/edição/curadoria
- `src/routes/social.ts` — Social Agent
- `src/db/schema.sql` — schema atual
- `DEPLOY_CHECKLIST.md` — passos exatos para publicar
