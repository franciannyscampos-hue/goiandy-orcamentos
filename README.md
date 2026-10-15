# Goiandy Orçamentos

Portal de catálogo online por cliente, com tabelas de preço por indústria e orçamento por e-mail.
Endereço: pedidos.goiandyrep.com.br

## Tecnologia
Hono (TypeScript) no Cloudflare Pages, banco D1 e arquivos no R2 (mesma base do gerador de catálogo, mas projeto separado).

## Publicação no Cloudflare Pages
- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: nenhum

## Rodar no computador (opcional)
```
npm install
npm run build
npx wrangler pages dev ./dist
```
