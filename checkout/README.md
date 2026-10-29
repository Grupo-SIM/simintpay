# Checkout

Next.js checkout imported from `checkout-form-generic`. Application routes, assets and payment contracts remain in this workspace. Source repository stays independent.

Run from monorepo root:

```sh
bun install --frozen-lockfile
cp checkout/.env.example checkout/.env.local
bun turbo -F checkout dev
bun turbo -F checkout build
bun turbo -F checkout test:unit
```

Development listens on port 3000. `bun turbo -F checkout start` serves a local production build; container runtime uses the standalone server.

Checkout owns React, Next.js, payment UI packages and its ESLint/Tailwind/PostCSS configuration. Root owns Bun fmt, Turbo and Git hooks. Use the root Bun lockfile; no workspace lockfiles or independent package installs.

Public API origins live in `src/lib/api-config.ts`. Configure `NEXT_PUBLIC_SIM_API_URL`, `NEXT_PUBLIC_API_PAGATG_URL` and `NEXT_PUBLIC_EBOOK_API_URL` before building; Next.js embeds these in browser bundles. Existing production origins remain defaults for compatibility. Browser API calls happen after page load, not during compilation. Connectivity diagnostics under `scripts/` contact external services and are never part of builds or checks.

Production builds enforce TypeScript. `check-types` generates Next route types before checking. ESLint uses Next's flat configuration; `next lint` is no longer used. Google fonts are downloaded during production builds.

Imported forms retain existing state synchronization in effects. Next's `set-state-in-effect` rule remains a warning for those eight files; other hook correctness checks stay enforced. Gateway payloads retain existing dynamic types.

Root `bun dev` delegates to `bun turbo dev` and runs both applications. Filtered checkout dev follows `checkout/turbo.json`: backend export finishes first, while backend dev runs as a persistent companion. Backend is a development-only workspace dependency; checkout never imports backend runtime code. Builds also wait for backend export. Export writes controller metadata offline without connecting to services.

## Prévia de links de pagamento

`GET /preview/payment-link?parentOrigin=https%3A%2F%2Fsimintpay.com` abre o SimLink atual em modo de prévia. O painel envia o rascunho por `postMessage`, sem criar ou salvar link. O contrato versão 1 é validado em `src/lib/payment-link-preview.ts` e contém apenas título, descrição, preço, métodos e parcelas calculadas.

A origem padrão autorizada é `https://simintpay.com`. Para outras instalações, configure `CHECKOUT_PREVIEW_PARENT_ORIGINS` no ambiente **de execução** do container do checkout, separando origens HTTPS exatas por vírgula. Configuração explicitamente vazia bloqueia todas; localhost só é aceito em desenvolvimento. A lista usada no navegador vem da página de servidor, sem novo argumento de build Docker ou variável pública adicional.

`src/proxy.ts` aplica CSP `frame-ancestors`, `no-store` e `no-referrer` apenas nessa rota. Política das demais rotas permanece intacta. Prévia não consulta link salvo, recalcula ofertas no servidor, tokeniza cartão, gera PIX, consulta status ou executa funil/redirecionamento de pagamento. Botões de avançar continuam ativos; botões finais de pagamento ficam desativados. Não use dados pessoais reais.

Validação local: `bun run --cwd checkout test:unit` e `bun run --cwd checkout build`. Publicação do container corrigido deve ser feita pelo responsável: sem essa atualização, a versão pública anterior continuará retornando 404.
