# Atlas Report Cards — Design Spec
**Date:** 2026-05-14  
**Status:** Approved

## Overview

Add 14 new financial metric cards to the `/relatorio` page of front-simpay, visible when the AtlasHosting product is selected. Cards show granular cost/profit breakdown specific to the Atlas platform.

## Architecture

```
Front-simpay
    ↓ GET /admin/relatorios/atlas-consolidado?startDate=&endDate=
Back-simpay (NestJS)
    ↓ DB: transactions filtered by ATLAS_USER_ID + date range + status=COMPLETED
    ↓ HTTP GET atlas-hosting/api/internal/report?startDate=&endDate= (shared secret auth)
Atlas-hosting (Next.js API route)
    → domain invoices paid in period (with namecheapCostBrl from metadata)
    → VPS invoices paid in period
    → affiliate commissions: total available (current balance) + total withdrawn in period
    → withdrawal requests: count pending, count approved in period, sum of fees
```

## Changes Required

### 1. atlas-hosting — Save Namecheap cost in invoice metadata

**File:** `src/app/actions.ts` (domain invoice creation flow)  
**Change:** After calculating `priceInBrl`, also calculate `namecheapCostBrl` (the USD→BRL base price before markup) and store it in `invoice.metadata`.

Formula to derive namecheap cost:
```
namecheapCostBrl = (priceInBrl - DOMAIN_FIXED_FEE * years) / fee_multiplier
```
Since we're computing it DURING invoice creation (before applying the fee), store `baseUsdAsBrl` (result of `currencyConversion.convert`) directly.

**Type change:** Add `namecheapCostBrl?: number` to `DomainRegisterInvoiceOptions` in `src/lib/db/schema/tables/invoice.ts`.

### 2. atlas-hosting — Internal report API route

**New file:** `src/app/api/internal/report/route.ts`  
**Method:** GET  
**Auth:** Validates `x-internal-secret` header against `INTERNAL_REPORT_SECRET` env var  
**Query params:** `startDate`, `endDate` (ISO strings)

**Response shape:**
```typescript
{
  // Domain invoices paid in period
  domains: {
    totalRevenue: number;        // sum(invoice.amount)
    totalNamecheapCost: number;  // sum(invoice.metadata.namecheapCostBrl)
    count: number;
  };
  // VPS invoices paid in period
  vps: {
    totalRevenue: number;        // sum(invoice.amount)
    totalContaboCost: number;    // sum(invoice.amount / 2)
    count: number;
  };
  // Affiliate commissions — current state (not period-filtered)
  affiliates: {
    totalAvailable: number;      // sum(commissionAmount where status="available") — total repasse
    totalWithdrawn: number;      // sum(withdrawal.amount where status="approved" AND date in period) — lucro afiliado
    commissionGeneratedInPeriod: number; // sum(commissionAmount created in period) — custo afiliado
  };
  // Withdrawal requests
  withdrawals: {
    pendingCount: number;        // count(pgWithdrawalRequests where status="pending")
    approvedInPeriodCount: number; // count(approved in period)
    approvedInPeriodFeeSum: number; // sum(fee for approved in period) — lucro saque simpay
  };
}
```

**Env var to add:** `INTERNAL_REPORT_SECRET` in atlas-hosting `.env`

### 3. back-simpay — New consolidated atlas endpoint

**New controller method in:** `src/presentation/controllers/admin.controller.ts`  
**Route:** `GET /admin/relatorios/atlas-consolidado`  
**Auth:** Admin JWT (same as all other /admin/relatorios routes)  
**Query params:** `startDate`, `endDate`

**Logic:**
1. Fetch atlas transactions from DB: `WHERE userId = ATLAS_USER_ID AND status = COMPLETED AND createdAt BETWEEN startDate AND endDate`
2. Call `ATLAS_URL_APP + /api/internal/report?startDate=&endDate=` with `x-internal-secret` header
3. Compute and return all 14 metrics

**Response shape:**
```typescript
{
  taxaSimInt: number;           // Σ(bruto × (1 - ATLAS_LIQUIDEZ) + R$4) per tx
  taxaAdquirente: number;       // qtd_tx × ATLAS_TAXA_FIXA_TRANSACAO (R$1)
  custoCashback: number;        // qtd_tx × ATLAS_TAXA_CASHBACK (R$3)
  custoDominio: number;         // from atlas API: domains.totalNamecheapCost
  custoHospedagem: number;      // from atlas API: vps.totalContaboCost
  receitaLiquidaSimintpay: number; // taxaSimInt - taxaAdq - custoCashback - taxaSaque + lucroSaque
  lucroLiquidoDominio: number;  // domains.totalRevenue - custoDominio
  lucroLiquidoVps: number;      // vps.totalRevenue / 2
  lucroAfiliado: number;        // withdrawals approved in period (total amount withdrawn)
  totalRepasseAfiliado: number; // affiliates.totalAvailable (current balance)
  lucroSimpayDeSaque: number;   // withdrawals.approvedInPeriodCount × R$2
  receitaLiquidaAtlas: number;  // (domains.totalRevenue + vps.totalRevenue) - taxaSimInt - custoDominio - custoHospedagem - custoAfiliadoPeriodo
  saquePendente: number;        // withdrawals.pendingCount (count)
  roiSimintpay: number;         // receitaLiquidaSimintpay / receitaTotalAtlas × 100
  // Supporting values
  receitaTotalAtlas: number;    // sum(transaction.amount) from atlas txs
  qtdTransacoes: number;
}
```

**Env vars used:** `ATLAS_USER_ID`, `ATLAS_LIQUIDEZ`, `ATLAS_TAXA_FIXA_TRANSACAO`, `ATLAS_TAXA_CASHBACK`, `ATLAS_TAXA_SAQUE_FIXA`, `ATLAS_URL_APP`, `INTERNAL_REPORT_SECRET`

### 4. front-simpay — New cards section

**File:** `src/app/(dashboard)/relatorio/page.tsx`  
**Change:** When selected product is AtlasHosting, call `GET /admin/relatorios/atlas-consolidado` and render 14 new cards in a dedicated section below the existing cards.

**API service:** Add `getAtlasConsolidado(startDate, endDate)` to the relatorio service.

**Cards layout:** Grid 4 columns (matching existing layout), separate section with title "Relatório Detalhado Atlas".

## Formula Reference

| Card | Formula |
|------|---------|
| Taxa Sim Int | Σ( amount × (1 − ATLAS_LIQUIDEZ) + (TAXA_FIXA + TAXA_CASHBACK) ) |
| Taxa Adquirente | qtd × ATLAS_TAXA_FIXA_TRANSACAO |
| Custo Cashback | qtd × ATLAS_TAXA_CASHBACK |
| Custo Domínio | Σ(invoice.metadata.namecheapCostBrl) |
| Custo Hospedagem | Σ(invoice.amount) / 2 for VPS |
| Receita Líquida SimIntPay | taxaSimInt − taxaAdq − custoCashback − taxaSaque + lucroSaque |
| Lucro Líq. Domínio | Σ(domain invoice.amount) − custoDomínio |
| Lucro Líq. VPS | Σ(vps invoice.amount) / 2 |
| Lucro Afiliado | Σ(withdrawalRequest.amount) aprovados no período |
| Total Repasse Afiliado | Σ(commission.commissionAmount where status="available") |
| Lucro SimIntPay Saque | qtd_saques_aprovados × R$2 |
| Receita Líquida Atlas | (ΣdomainRev + ΣvpsRev) − taxaSimInt − custoDom − custoVps − custoAfiliadoPeriodo |
| Saque Pendente | count(pgWithdrawalRequests where status="pending") |
| ROI SimIntPay | (receitaLiquidaSimintpay / receitaTotalAtlas) × 100% |

## Notes

- `totalRepasseAfiliado` is current state (not period-filtered) — shows current balance in all affiliate wallets
- `lucroAfiliado` filters by withdrawal approval date in the selected period
- `custoAfiliadoPeriodo` (for receitaLiquidaAtlas) = commissions generated (created) in the period
- The R$4 fixed per tx = R$1 (taxa fixa DOM) + R$3 (cashback) — already included in taxa_sim_int but itemized separately as costs
- `taxaSaque` in receitaLiquidaSimintpay = 0 for atlas (ATLAS_TAXA_SAQUE_PERCENT=0); `lucroSaque` = qtd_saques_aprovados × R$2

## Out of Scope

- Historical backfill of `namecheapCostBrl` for existing invoices (missing data will show 0)
- Breakdown by domain TLD or VPS plan
- Affiliate-level breakdown (only totals)
