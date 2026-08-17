# Yasmin AI — Content & Automation Studio

Backend/API do Yasmin AI Studio para Cloudflare Workers, D1, R2, KV e Workers AI.

## Estado atual

Esta revisão entrega o backend funcional e preparado para receber um frontend separado. O painel visual ainda não está incluído.

### Implementado

- modelos e identidade da Yasmin
- Reference Vault em R2
- Prompt Engine
- geração de imagem por Cloudflare Workers AI
- geração/edição opcional via OpenAI
- Provider Router com fallback
- histórico de jobs e assets
- Library e Planner
- Trends e Content Opportunities
- Automation Rules + Cron Trigger
- Social Agent para legendas/hashtags via Workers AI
- autenticação administrativa (PBKDF2 + JWT)
- rate limiting via KV
- dashboard e health check
- logs de atividade e learning signals

## Arquitetura

```text
Cliente / futuro painel
        |
        v
Cloudflare Worker (Hono)
        |--- D1: metadados
        |--- R2: imagens
        |--- KV: rate limiting
        |--- Workers AI: imagem/texto
        `--- OpenAI opcional
```

## Instalação

```bash
npm install
npm run typecheck
```

Depois siga **DEPLOY_CHECKLIST.md**.

## Login

Antes do deploy em produção configure:

```bash
npm run hash:password -- "SUA-SENHA-FORTE"
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put JWT_SECRET
```

Login:

```http
POST /auth/login
Content-Type: application/json

{"password":"SUA-SENHA"}
```

As demais rotas administrativas exigem:

```http
Authorization: Bearer TOKEN
```

## Cloudflare

Bindings previstos em `wrangler.jsonc`:

- `DB` -> D1 `yasmin-db`
- `ASSETS_BUCKET` -> R2 `yasmin-assets`
- `CACHE` -> KV `yasmin-cache`
- `AI` -> Workers AI

O cron roda a cada 15 minutos e executa regras ativas de automação.

## Rotas principais

| Método | Rota | Uso |
|---|---|---|
| POST | `/auth/login` | login administrativo |
| GET/POST | `/models` | modelos |
| GET/PUT | `/models/:slug/identity` | identidade |
| GET/POST | `/models/:slug/references` | Reference Vault |
| POST | `/models/:slug/generate` | gerar imagem |
| POST | `/models/assets/:id/edit` | editar asset com provider compatível |
| POST | `/models/:slug/caption` | legenda + hashtags |
| GET/POST | `/library` | biblioteca |
| GET/POST | `/planner` | planejamento |
| GET/POST | `/trends` | tendências |
| GET/POST/PATCH/DELETE | `/automations` | regras |
| POST | `/automations/run` | executar regras manualmente |
| GET | `/dashboard` | dashboard agregado |
| GET | `/health` | saúde do sistema |
| GET | `/assets/*` | streaming autenticado do R2 |

## Edição de imagem

- **OpenAI**: implementada via `POST /images/edits`, quando `OPENAI_API_KEY` estiver configurada.
- **Cloudflare**: geração funciona normalmente; edição continua reportando `unsupported_feature` porque o FLUX.2 atual exige referências menores que os assets padrão deste projeto. Não anunciamos uma função como ativa se ela não funcionar de ponta a ponta.

## Segurança

Nunca versione `.dev.vars`, `.env` ou chaves reais. API keys e segredos ficam em Cloudflare Secrets.

## Continuidade

Leia `PROJECT_STATUS.md` antes de continuar o desenvolvimento. Para publicar, use `DEPLOY_CHECKLIST.md`.
