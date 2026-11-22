# 0027 Modos de taxa unificados (ADDITIVE_ONLY real) e Delivery no caminho padrão

Parte A do plano aprovado (SimIntPay). A Parte B (Sim Delivery) é feita no repositório dele.

## Regra-alvo

| Modo             | Vendedor paga                                   | Comprador paga                     |
| ---------------- | ----------------------------------------------- | ---------------------------------- |
| `SIMINTPAY_ONLY` | adquirente + adicional SimIntPay (ou taxa alvo) | base + juros repassados            |
| `BOTH`           | adquirente + adicional SimIntPay (ou taxa alvo) | base + juros repassados + aditivas |
| `ADDITIVE_ONLY`  | nada (taxa alvo ignorada)                       | base + juros repassados + aditivas |

- Aditivas são receita SimIntPay somada ao total do comprador, nunca descontada do vendedor.
- Juros seguem `passInterestPpm` da plataforma em todos os modos.
- No `ADDITIVE_ONLY` a SimIntPay paga a adquirente e os juros não repassados com as aditivas
  (margem = aditivas − custo da adquirente − juros não repassados, podendo ser negativa).

## Passos

- [x] A1. Motor de cotação (`financial-charge.ts`): `applyFeeMode`, aditivas no comprador, itens explícitos,
      snapshot com `additiveFeeCents`/`sellerFeeCents`/`acquirerCostBorneBySimCents`, inversão POS.
- [x] A2. Consumidores: `simulateFinancialPolicy`, `evaluateCoverage`, caminho padrão de pagamentos
      (coprodução, idempotência, custo da adquirente), relatórios.
- [ ] A3. Endpoint de cotação `POST /platforms/:tag/merchants/:companyId/payments/quote`,
      `expectedTotalCents` (409 `QUOTE_CHANGED`), `allocation` depreciado e opcional para o Delivery, SDK.
- [ ] A4. Frontend: simulação e taxa alvo desabilitada no `ADDITIVE_ONLY`.
- [ ] A5. Docs e testes.

## Pendências

- Remoção definitiva de `allocation` só depois da Parte B publicada (commit separado, fora deste plano).
