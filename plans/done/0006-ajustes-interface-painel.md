# Ajustes de interface e filtros do painel — backend

Execução local do [plano aprovado no frontend](../../../simintpay-front/plans/0006-ajustes-interface-painel.md).

- [x] Contrato `GET /assinantes`: busca, plataforma, primeira cobrança, status agrupado e frequência.
- [x] Mesclar pausas locais e resolver plataformas antes de filtrar/paginar conjunto completo.
- [x] Exclusão local do histórico somente para admin master e status conhecido desativado; reconsultar adquirente e pausa antes de persistir.
- [x] Regras de negócio, testes com adquirente simulada e build local.

## Validação

- 11 novos testes Bun passaram, com 26 asserções. Incluem 650 registros, filtros combinados, mensal/anual, pausas locais, paginação e mudanças concorrentes de estado. Adaptador DOM preserva estados desconhecidos/ausentes e pausados, sem convertê-los implicitamente em inativos.
- 9 testes Jest legados dos dois casos de uso passaram durante validação de regressão; mantidos intactos. Novos testes ficam em `.test.ts` e usam `bun:test`.
- `bun run build` passou. Nenhum banco, adquirente ou serviço externo foi acessado.
