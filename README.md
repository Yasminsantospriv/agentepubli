# Yasmin Trend Agent

Agente privado em Cloudflare para transformar sinais de tendência em um pacote diário revisável: briefing original, legenda em pt-BR e três imagens 4:5 consistentes com a identidade fictícia da Yasmin.

## O que ele faz

1. Às 09:00 no horário de São Paulo, inicia um Cloudflare Workflow durável.
2. Consulta posts recentes de uma lista autorizada de contas profissionais do Instagram com idade declarada e verificada entre 19 e 23 anos.
3. Usa o TikTok Creative Center como sinal cruzado de hashtags. Links públicos do TikTok cadastrados manualmente podem ser lidos via oEmbed.
4. Extrai apenas atributos abstratos da referência: ambiente, enquadramento, luz, roupa, pose, clima e gancho visual.
5. Cria um briefing que muda ao menos três elementos. O rosto e os detalhes únicos da pessoa real não são passados ao gerador.
6. Gera três imagens 1024 × 1280 com FLUX.2 dev usando somente as três referências canônicas da Yasmin.
7. Audita idade adulta aparente, segurança para plataforma, identidade, anatomia, tatuagens, acessórios proibidos, logos e semelhança indevida.
8. Faz uma tentativa corretiva automática por foto. Um resultado que continue reprovado fica bloqueado.
9. Entrega imagens e legenda por links privados temporários. A publicação permanece manual após sua aprovação.

## Arquitetura

- Cloudflare Workflow: execução diária, repetição segura e retries.
- Workers AI: Llama 4 Scout para visão/JSON e FLUX.2 dev para as fotos.
- D1: fontes, histórico, decisões, briefs, legendas e auditorias.
- R2 privado: referências canônicas, referências de tendência e fotos geradas.
- Worker API: autenticação Bearer, CORS restrito ao painel e links R2 assinados por HMAC.

Nenhum token é incluído no repositório. Referências reais e imagens geradas não são públicas no bucket.

## Ativação

Requisitos: Node.js 24+, conta Cloudflare com Workers AI, Workflows, D1 e R2, e um token Meta de longa duração com acesso à sua conta profissional do Instagram.

```bash
npm install
npx wrangler login
npm run deploy
npm run migrate:remote
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put ASSET_SIGNING_SECRET
npx wrangler secret put INSTAGRAM_ACCESS_TOKEN
npx wrangler secret put INSTAGRAM_USER_ID
```

Use valores aleatórios diferentes para `ADMIN_API_TOKEN` e `ASSET_SIGNING_SECRET`. Digite os segredos diretamente no terminal da Cloudflare; não os envie por chat ou grave em arquivos versionados.

O primeiro `wrangler deploy` provisiona os recursos declarados no `wrangler.jsonc`. Depois da migração, confirme:

```bash
curl https://SEU-WORKER.workers.dev/health
```

## Configuração inicial da Yasmin

Defina as variáveis abaixo no seu terminal:

```bash
export YASMIN_WORKER_URL="https://SEU-WORKER.workers.dev"
export YASMIN_ADMIN_TOKEN="seu-token-administrativo"
```

Envie três fotos canônicas já reduzidas para 128–512 px por lado, JPEG/PNG/WebP, até 1 MB cada:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/identity" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN" \
  -F "label=Yasmin frontal" \
  -F "file=@yasmin-frontal.jpg"
```

Repita para os ângulos 3/4 e lateral. Depois cadastre uma lista pequena e estável de fontes. A idade deve ter sido confirmada fora do agente; ele não tenta inferi-la pelo rosto.

Instagram:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/sources" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"instagram","handle":"perfil_profissional","declaredAge":21,"adultVerified":true,"notes":"idade conferida na bio/fonte pública"}'
```

TikTok, para um post público específico:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/sources" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"platform":"tiktok","externalUrl":"https://www.tiktok.com/@perfil/video/ID","declaredAge":22,"adultVerified":true}'
```

## Execução e revisão

Iniciar fora do horário:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/run" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN"
```

Consultar fila e pacote final:

```bash
curl "$YASMIN_WORKER_URL/api/runs" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN"

curl "$YASMIN_WORKER_URL/api/runs/ID_DA_EXECUCAO" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN"
```

O detalhe contém a legenda e três `downloadUrl` temporárias. Aprovar:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/runs/ID_DA_EXECUCAO/decision" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"decision":"approved"}'
```

Gerar uma variação com o mesmo briefing:

```bash
curl -X POST "$YASMIN_WORKER_URL/api/runs/ID_DA_EXECUCAO/regenerate" \
  -H "Authorization: Bearer $YASMIN_ADMIN_TOKEN"
```

## Verificação local

```bash
npm run types
npm run check
```

Para desenvolvimento, copie `.dev.vars.example` para `.dev.vars`, preencha localmente e execute `npm run migrate:local` e `npm run dev`.

## Limites intencionais

- Não publica automaticamente. A aprovação humana evita um post inadequado ou uma identidade inconsistente.
- Não faz scraping de perfis arbitrários nem tenta contornar APIs. O TikTok Research API não é destinado a esta automação comercial.
- “Nicho hot” significa sensual e compatível com as regras da plataforma: sem nudez, ato sexual, idade ambígua ou conteúdo explícito.
- A pessoa da tendência nunca é clonada. A referência visual é privada e serve apenas para derivar características genéricas.
