# Auto Deploy Cloudflare

Painel em TypeScript para publicar templates GitHub públicos direto em Cloudflare Workers com D1, R2, KV, Workers Builds, secrets e domínio customizado.

## Setup local

```powershell
npm install
npm run db:migrate:local
wrangler secret put APP_ADMIN_SECRET
wrangler secret put TOKEN_ENCRYPTION_KEY
npm run dev
```

Em outro terminal, rode o Worker local para a API:

```powershell
wrangler dev
```

## Produção

1. Crie D1 e R2 para este painel.
2. Atualize `wrangler.jsonc` com `database_id` e bucket real.
3. Configure os secrets:

```powershell
wrangler secret put APP_ADMIN_SECRET
wrangler secret put TOKEN_ENCRYPTION_KEY
```

4. Rode `npm run db:migrate:remote` e `npm run deploy`.

## Token Cloudflare

O token usado para criar sites precisa ser de usuário para Workers Builds e deve incluir permissões de Workers Builds, Workers Scripts, D1, R2, KV, Zones e Workers Routes/Domains. A integração GitHub "Cloudflare Workers and Pages" precisa ser autorizada uma vez no dashboard da Cloudflare.
