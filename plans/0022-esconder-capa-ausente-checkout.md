# 0022 - Esconder a capa do produto quando ela não existe (checkout)

Status: implementado (code-complete); validação visual por screenshot pendente

## Contexto

Capas de produto ainda não existem no cadastro, então `imagemUrl`/`image` chegam vazios. Hoje o
`ProductImage` (`checkout/src/components/checkout/ui/ProductImage.tsx`) renderiza um bloco cinza com
o ícone de sacola quando `src` é vazio, ocupando um bloco grande (`h-40`) no card do produto.
Ao não haver capa, o bloco deve sumir e o card deve mostrar só título, descrição e preço.

`CheckoutFlow.tsx` já faz isso (`product.image && <ProductImage />` com layout condicional). Falta
aplicar o mesmo nos demais pontos de uso.

## Escopo

Apenas o app `checkout/`. Sem mudanças de backend, SDK ou i18n.

## Passos

1. **Decisão de design**: manter `ProductImage` com o placeholder somente onde a miniatura é
   essencial para o layout (miniaturas pequenas), e esconder nos blocos grandes. Alternativa mais
   simples: nova prop `hideWhenEmpty` em `ProductImage` que retorna `null` sem `src`, usada nos
   blocos grandes.
2. `simlink/SimLinkCheckout/index.tsx` (~l.1025, card do produto mobile, o do print): não renderizar
   a imagem sem `link.imagemUrl`; ajustar o espaçamento do card (como o `pt-[18px]` do
   `CheckoutFlow`) para não sobrar `gap` vazio.
3. `simlink/LinkOffers.tsx`: blocos grandes de upsell/downsell (~l.381 mobile downsell 140px, ~l.403
   mobile 180px, ~l.432 desktop 440px). Esconder sem `offer.imagemUrl`; no desktop, o grid
   `lg:grid-cols-[440px_minmax(0,1fr)]` deve virar coluna única (conteúdo centralizado) quando não
   há imagem.
4. Miniaturas pequenas (`SummaryAside` 56px, item de oferta em `LinkOffers` ~l.118 60px): decidir
   com o usuário se também somem ou mantêm o ícone (padrão proposto: somem e o texto ocupa a
   largura toda, para ficar consistente).
5. Atualizar o comentário do `ProductImage` (hoje diz "o design só tem placeholder").

## Validação

- Skill `ui-screenshot-validation`: capturar o checkout simlink (mobile e desktop) e as telas de
  upsell/downsell com e sem imagem; confirmar que sem imagem não há bloco vazio nem espaço sobrando.
- Commit atômico `fix(checkout): ...`; validação via hook de pré-commit (sem rodar type-check à mão).
- Implementar via skill `task-worktree`.

## Pendências

- Ponto 4 decidido: miniaturas também somem (não há ícone). Implementado tornando `ProductImage` nulo sem `src`.
- Validação visual por screenshot ainda não realizada.
