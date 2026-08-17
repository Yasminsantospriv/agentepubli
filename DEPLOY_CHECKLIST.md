# Deploy Checklist — Yasmin AI Studio

Este repositório deve ser enviado inteiro para o GitHub. Não copie arquivos individualmente.

## 1. Estrutura

A raiz do repositório é a pasta que contém:

- `package.json`
- `wrangler.jsonc`
- `src/`
- `scripts/`
- `README.md`

## 2. Instalar dependências e validar

```bash
npm install
npm run typecheck
```

## 3. Criar D1

```bash
npx wrangler d1 create yasmin-db
```

Copie o `database_id` retornado para `wrangler.jsonc`.

Instalação nova:

```bash
npm run db:migrate:remote
npx wrangler d1 execute yasmin-db --remote --file=./src/db/seed.sql
```

Se você JÁ tinha criado o banco com a versão antiga deste projeto, rode apenas uma vez:

```bash
npx wrangler d1 execute yasmin-db --remote --file=./src/db/migrations/0002_existing_database_upgrade.sql
```

## 4. Criar R2

```bash
npx wrangler r2 bucket create yasmin-assets
```

## 5. Criar KV

```bash
npx wrangler kv namespace create yasmin-cache
```

Copie o ID retornado para `wrangler.jsonc` em `kv_namespaces[0].id`.

## 6. Criar senha administrativa

Gere o hash localmente:

```bash
npm run hash:password -- "SUA-SENHA-FORTE"
```

Copie o resultado inteiro e salve como secret:

```bash
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Crie um JWT secret aleatório e salve:

```bash
npx wrangler secret put JWT_SECRET
```

Você pode gerar um valor forte com:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## 7. APIs opcionais

OpenAI é opcional. Cloudflare Workers AI continua sendo o provider padrão.

```bash
npx wrangler secret put OPENAI_API_KEY
```

Os demais providers continuam como stubs até a integração específica ser implementada.

## 8. Testar localmente

```bash
npm run dev
```

Para testar o cron:

```bash
npm run dev:scheduled
```

## 9. Login

```http
POST /auth/login
Content-Type: application/json

{"password":"SUA-SENHA"}
```

Use o token retornado nas outras rotas:

```http
Authorization: Bearer SEU_TOKEN
```

## 10. Deploy

```bash
npm run deploy
```

## O que foi implementado nesta revisão

- autenticação administrativa com senha PBKDF2 + JWT
- proteção das rotas administrativas
- rate limiting via KV em geração, edição e geração de legenda
- Social Agent para legenda/hashtags usando Workers AI
- Cron Trigger a cada 15 minutos
- executor real de regras de automação suportadas
- edição de imagem real via OpenAI Images Edits (quando a chave estiver configurada)
- `/health` não mente mais que o frontend está online
- schema/seed revisados

## Ainda falta

O painel visual/frontend completo ainda não faz parte deste repositório. A API está pronta para receber esse frontend em uma próxima etapa.
