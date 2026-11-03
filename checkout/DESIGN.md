# Design — Checkout Novo (SimLink)

Implementação do design **"Checkout Novo"** (mobile, 390px) e **"Checkout Novo Desktop"** (1280px) no checkout de **link de pagamento** (`?simLinkCode=...`).

> **Todos os checkouts** usam a UI nova:
>
> - **SimLink** (`src/components/simlink/`): implementação completa do fluxo em etapas, descrita abaixo.
> - **Demais checkouts** (`card/creditCardForm` — o padrão, sem parâmetro —, `simplan`, `simpixplan`, `simsubscriptionlink`, `simboleto`) e `assinatura-sucesso`: receberam o visual novo pelos componentes compartilhados (seção "Checkouts compartilhados"). A estrutura deles (accordion, campos, status) e toda a lógica continuam iguais.

## Checkouts compartilhados

Os componentes em `src/components/checkout/` foram redesenhados com os tokens deste documento. Por isso a mudança chega a todos os checkouts sem mexer em lógica.

| Componente                                  | Visual novo                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.checkout-page-bg` (globals.css)           | Fundo `#07060b` com gradientes cobre e lilás (variações mobile e desktop) e fonte Outfit.                                                                               |
| `CheckoutMain`                              | Header (logo SimPay + selo "Pagamento protegido"). Desktop: formulário à esquerda e resumo de 400px fixo à direita. Mobile: coluna de até 480px, com o resumo primeiro. |
| `CheckoutBrandingRow`                       | Logo do cliente (ex.: `/1.svg` do creditCardForm) à esquerda + selo à direita. Se o checkout não usa esse componente, o `CheckoutMain` mostra o logo SimPay.            |
| `CheckoutUiCard`                            | Vidro com raio 28. Título 19px sem caixa alta. Variantes `danger` e `success` na paleta nova.                                                                           |
| `CheckoutGlassField` / `CheckoutGlassInput` | Label `#b8b2c6`, asterisco laranja, campo `.sp2-input` (52px, raio 16, foco laranja) e prefixo `+55` com divisória.                                                     |
| `CheckoutAccordionSection`                  | Seção com raio 22, ícone laranja dentro de círculo e título 17px.                                                                                                       |
| `CheckoutStatusCard`                        | Checklist com bolinha em gradiente (ok) ou cinza (pendente). Em caso de erro, caixa vermelha no estilo da tela 3d.                                                      |
| `CheckoutSummaryTrustPanel`                 | Selos "Conexão criptografada…" e "Dados tratados conforme a LGPD".                                                                                                      |
| `CheckoutSummaryBranding`                   | Não renderiza mais nada: a marca foi para o header.                                                                                                                     |
| `CheckoutFooter`                            | "Processado por Simintpay".                                                                                                                                             |

Nas classes fixas dos 5 checkouts, só os tokens de cor e forma foram trocados (script de substituição restrito a strings de classe, sem alterar lógica):

| Antes                                                       | Depois                               |
| ----------------------------------------------------------- | ------------------------------------ |
| botões `bg-violet-500` / `bg-violet-600` / `bg-emerald-600` | `.sp2-cta` (gradiente, 58px)         |
| `violet-*` (texto, borda, fundo, foco, `accent-`)           | equivalentes laranja/creme da paleta |
| inputs crus `bg-black/25`                                   | campo de vidro                       |

**O que fica fora** (é asset, não estilo):

- A animação Lottie do carrinho, em roxo, continua igual.
- O preview `react-credit-cards-2` nos checkouts de plano e assinatura continua igual. O cartão ilustrado novo existe só no SimLink.

## Regras de comportamento preservadas

A camada visual mudou; a lógica de pagamento não. Continuam iguais:

- `GET /links-pagamento/public/:code` (carregar o link) e `GET /links-pagamento/public/:id?orderBumps=...` (recalcular com bumps, com controle de sequência).
- Tokenização do cartão via `getTokenCard` (`sdk.tsx`), com a mesma chave pública e os mesmos campos.
- Body de `POST /pix` e `POST /charge`: mesmos campos, incluindo `orderBumpIds`.
- Status recusado: `FAILED | REJECTED | EXPIRED | DECLINED | REFUNDED | CHARGEBACK`. Status aprovado: `PAID | APPROVED | COMPLETED`.
- Confirmação do PIX por SSE com fallback de status e reconexão (`usePixConfirmation`).
- Funil: upsell só com o pedido aprovado. Se o cliente recusa o upsell e existe downsell, mostra o downsell. A oferta é cobrada 1x no mesmo cartão (com nova tokenização) ou por um novo PIX.
- Redirect em nova aba só depois do funil. Com cartão, o cliente vai para `/payment/success?reference=...`.
- Rótulo de parcelas via `buildInstallmentLabel`: o aviso "(com juros)" sai do total comparado ao valor original.
- Bumps ficam travados depois que o PIX é gerado.

## Arquivos

| Arquivo                                            | O que é                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/checkout/ui/`                      | Primitivas visuais: `Screen`, `DesktopHeader` (logo + stepper + selo), `MobileTopBar`, `MobileProgress`, `CtaButton`, `Field`, `SummaryRow`, `SummaryAside`, `StatusPill`, `ErrorBox`, `Spinner`, `ProductImage`, `useCountdown`, `formatCurrency` e as constantes `GLASS`, `LG_GLASS` e `SM_GLASS`. |
| `src/components/simlink/SimLinkCheckout/index.tsx` | Fluxo em etapas, estados (processando, recusado, sucesso PIX) e resumo lateral.                                                                                                                                                                                                                      |
| `src/components/simlink/LinkOffers.tsx`            | `OrderBumpCard` (novo visual) e `FunnelOfferScreen` (upsell/downsell).                                                                                                                                                                                                                               |
| `src/components/simlink/PixPayment.tsx`            | `PixDisplay` (QR, contagem regressiva, copia e cola, passos) e `usePixConfirmation`, que não mudou.                                                                                                                                                                                                  |
| `src/app/globals.css`                              | Classes `.sp2*` em `@layer components`: fundos, CTA, inputs, spinner e radio.                                                                                                                                                                                                                        |
| `src/app/layout.tsx`                               | Carrega a fonte **Outfit** (`--font-outfit`). Ela só se aplica dentro de `.sp2`.                                                                                                                                                                                                                     |

## Fluxo e mapa de telas

| Etapa (`step`)         | Mobile | Desktop | CTA                                                  |
| ---------------------- | ------ | ------- | ---------------------------------------------------- |
| `pedido`               | 4a     | 5a      | Continuar                                            |
| `dados`                | 4b     | 5b      | Continuar para pagamento (valida antes de avançar)   |
| `forma`                | 4c     | 5c      | Continuar com {PIX/crédito/débito}                   |
| `cartao`               | 4d     | 5d      | Pagar {total}                                        |
| `pix` (antes de gerar) | 4e     | 5e      | Gerar código PIX                                     |
| `pix` (gerado)         | 3a     | 5f      | — ("Aguardando pagamento…")                          |
| processando cartão     | 3b     | 7a      | —                                                    |
| cartão recusado        | 3d     | 7c      | Tentar novamente / Usar outro cartão / Pagar com PIX |
| upsell                 | 2a     | 6a      | Sim, quero aproveitar                                |
| downsell               | 2c     | 6c      | Quero por {valor}                                    |
| sucesso (PIX)          | 3c     | 7b      | Acessar meu conteúdo (se houver `redirectUrl`)       |

- **Mobile:** header com voltar + título, barra de progresso de 3 segmentos (4a–4c) e CTA no fim da tela.
- **Desktop:** header com stepper (Pedido → Dados → Pagamento), conteúdo à esquerda e **resumo fixo à direita** (400px, `sticky`) com o CTA.
- **Botão voltar:** dados → pedido, forma → dados, cartão/PIX → forma. Some depois que o PIX é gerado, porque o valor já está fechado.

## Responsivo

- Breakpoint único: `lg` (≥ 1024px). Abaixo dele vale o layout mobile (coluna de até 480px); a partir dele, o desktop (até 1280px, padding 28/48/40).
- Quando o markup difere muito entre os layouts (lista de formas de pagamento, PIX antes de gerar), os dois blocos são renderizados e alternados com `lg:hidden` / `hidden lg:flex`. O estado é o mesmo para os dois.

## Tokens

### Cores

| Uso                            | Valor                                   |
| ------------------------------ | --------------------------------------- |
| Fundo base                     | `#07060b`                               |
| Texto principal                | `#f4f2f7`                               |
| Texto secundário               | `#a9a3b8`                               |
| Label de campo / descrição     | `#b8b2c6`                               |
| Texto suave                    | `#c8c2d4`, `#d9d4e3`                    |
| Placeholder / dica             | `#7d778b`                               |
| Acento laranja (ícones, links) | `#f6b67a`                               |
| Preço e linhas de bump         | `#ffc48f`                               |
| Erro                           | `#ff9d9d`, borda `rgba(255,160,160,.3)` |
| Status ok (bolinha)            | `#7be3b0`                               |
| Foco / selecionado (borda)     | `rgba(240,168,108,.7)`                  |

### Gradientes

| Uso                      | Valor                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| CTA                      | `linear-gradient(90deg, #8d80f4 0%, #c9c2f7 30%, #f3eef0 50%, #f6b67a 75%, #f58a2a 100%)`, texto `#17131f` |
| Selo de desconto / check | `linear-gradient(90deg, #a99ef8, #f6b67a)`                                                                 |
| Radio selecionado        | `radial-gradient(circle, #fff 0 36%, transparent 39%), linear-gradient(135deg, #9a8cf7, #f5a35a)`          |

Os fundos de tela são radiais lilás `rgba(124,106,232,…)` e cobre `rgba(201,154,104,…)`. Há variações `sp2-bg`, `-downsell`, `-processing`, `-success` e `-error`, com posições diferentes no mobile e no desktop.

### Vidro (glass)

- Base: `bg rgba(255,255,255,.07)` + borda `rgba(255,255,255,.13)` + `blur(24px)`.
- Desktop: `blur(28px) saturate(140%)` + `inset 0 1px 0 rgba(255,255,255,.1)`.

### Raios

| Elemento          | Raio  |
| ----------------- | ----- |
| Cards principais  | 28    |
| Cards secundários | 22–26 |
| Itens internos    | 20    |
| Inputs            | 16    |
| Botões e pílulas  | 999   |

### Tipografia

- Fonte: **Outfit** (300–700).
- Títulos de etapa: 24 (desktop) e 20 (mobile topbar).
- Headline do funil: 36 (desktop) e 26 (mobile).
- Total: 32 (aside), 26 (mobile pedido) e 34/40 (PIX).

### Alturas

| Elemento      | Altura                     |
| ------------- | -------------------------- |
| CTA           | 58                         |
| Input         | 52 (cartão no mobile: 50)  |
| Botão do bump | 44 (mobile) / 46 (desktop) |

## Desvios do design

| Ponto                                                              | Motivo                                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inputs com **16px** no mobile (design: 15px)                       | Abaixo de 16px o iOS Safari dá zoom ao focar o campo. O desktop usa 15px.                                                                                                   |
| Upsell e downsell **sem timer** (telas 2b/6b e o timer de 2c/6c)   | O backend não envia prazo da oferta. Mostrar um timer inventado seria contagem falsa. Para ativar, falta um campo de expiração em `FunnelOffer`.                            |
| Capa do produto só aparece se o backend enviar `imagemUrl` no link | `LinkData` não tinha imagem. O campo foi adicionado como opcional; sem ele, o card do pedido mostra só texto. Bumps e ofertas sem imagem mostram um bloco neutro com ícone. |
| Bandeira no cartão ilustrado                                       | A detecção é só visual (VISA, MASTERCARD, AMEX, ELO, HIPERCARD). Sem bandeira detectada, o campo fica vazio em vez de mostrar "BANDEIRA".                                   |
| Expiração do PIX                                                   | A contagem `mm:ss` vem de `pixExpire`. Se a data não for interpretável, aparece "Válido até {texto do backend}".                                                            |
| Validade em um campo só (`MM/AA`)                                  | Ela é dividida em `cardMonth` / `cardYear`, como antes, para não mudar o payload.                                                                                           |
| Mensagens de validação por campo e caixa de erro genérica          | O design não tem estado de erro de campo nem de API. Usei a mesma paleta de erro da tela 3d.                                                                                |
| Telas de carregamento e "link não encontrado"                      | Não existem no design. Seguem o padrão das telas 3b (spinner) e 3d (erro).                                                                                                  |
| Variante 1a/1b (checkout em página única)                          | Não foi implementada. Segui o fluxo em etapas (seções 4/5), que é o fluxo completo do design.                                                                               |

## Pendências para validar

- [ ] Texto **"Código válido por 30 minutos"** (4e/5e): confirmar com o backend se o PIX expira mesmo em 30 min.
- [ ] Texto **"Acesso enviado para {email}"** (sucesso PIX): confirmar que todo link envia o e-mail de acesso.
- [ ] A tela de sucesso do **cartão** continua sendo `/payment/success`, compartilhada com outros checkouts e não redesenhada. Redesenhá-la (7b/3c) afeta os outros fluxos.
- [ ] Teste em produção com valores reais: PIX com bump, crédito parcelado, débito, cartão recusado e funil completo (upsell aceito; upsell recusado → downsell).

## Adaptação ao monorepo

Portado do commit `b71f9e9b38b12b1ba6dfb38daf2a1fd85fdff85c`. Primitivas visuais ficam em arquivos individuais sob `src/components/checkout/ui/`. URLs públicas continuam centralizadas em `src/lib/api-config.ts`; correção de validação/layout do boleto, componentes extraídos e testes existentes foram preservados. Comandos e dependências seguem o Turbo deste monorepo.
