# Atlas Report Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 14 financial metric cards to the AtlasHosting report section in the simpay admin dashboard, with data coming from back-simpay (transactions) + atlas-hosting (invoices, affiliates, withdrawals).

**Architecture:** atlas-hosting exposes `GET /api/internal/report` (auth via `x-internal-token`); back-simpay has a new `GET /admin/relatorios/atlas-consolidado` endpoint that combines its own atlas transaction data with the atlas-hosting API response; front-simpay renders 14 new MetricCard components in a dedicated section when AtlasHosting product is selected.

**Tech Stack:** Next.js App Router + Drizzle ORM (atlas-hosting), NestJS + Prisma (back-simpay), React Query + Next.js (front-simpay)

---

## File Map

| File | Change |
|------|--------|
| `atlas-hosting/src/lib/db/schema/tables/invoice.ts` | Add `namecheapCostBrl?: number` to `DomainRegisterInvoiceOptions` |
| `atlas-hosting/src/app/actions.ts` | Capture base BRL cost before markup; add to invoice metadata |
| `atlas-hosting/src/app/api/internal/report/route.ts` | New: GET endpoint returning aggregated domain/VPS/affiliate/withdrawal data |
| `back-simpay/src/presentation/controllers/admin.controller.ts` | New `GET /admin/relatorios/atlas-consolidado` endpoint |
| `front-simpay/src/services/api/endpoints.ts` | Add `atlasConsolidado` key to `relatorios` section |
| `front-simpay/src/app/(dashboard)/relatorio/page.tsx` | Add `useQuery` + render 14 new MetricCard components |

---

## Constants Reference

| Env Var | Value | Meaning |
|---------|-------|---------|
| `ATLAS_LIQUIDEZ` | `0.91` | Merchant keeps 91%; simpay takes 9% |
| `ATLAS_TAXA_FIXA_TRANSACAO` | `1.00` | DOM acquirer fixed fee per tx (R$) |
| `ATLAS_TAXA_CASHBACK` | `3.00` | Cashback cost per tx (R$) |
| `ATLAS_TAXA_SAQUE_FIXA` | `2.00` | Simpay earns R$2 per approved affiliate withdrawal |
| `ATLAS_HOSTING_URL` | atlas URL | Used in back-simpay to call atlas-hosting |
| `API_MACHINE_INTERNAL_TOKEN` | secret | Header value sent by back-simpay to atlas-hosting |

---

## Task 1: atlas-hosting — Add `namecheapCostBrl` to invoice type

**Files:**
- Modify: `atlas-hosting/src/lib/db/schema/tables/invoice.ts` (lines 74–89)

- [ ] **Step 1: Add field to DomainRegisterInvoiceOptions**

Open `atlas-hosting/src/lib/db/schema/tables/invoice.ts`. The existing type at line 74 is:
```typescript
export type DomainRegisterInvoiceOptions = Pick<
  DomainPageParams,
  "whoisguard" | "years"
> & {
  simpayPaymentId?: string;
  pixTransactionId?: string;
  pixCheckout?: PixCheckoutSnapshot;
  testPaymentOnly?: boolean;
  bundleDomains?: string[];
  guestPassword?: string;
  guestCheckout?: boolean;
  isRenewal?: boolean;
};
```

Replace with:
```typescript
export type DomainRegisterInvoiceOptions = Pick<
  DomainPageParams,
  "whoisguard" | "years"
> & {
  simpayPaymentId?: string;
  pixTransactionId?: string;
  pixCheckout?: PixCheckoutSnapshot;
  testPaymentOnly?: boolean;
  bundleDomains?: string[];
  guestPassword?: string;
  guestCheckout?: boolean;
  isRenewal?: boolean;
  /** Base cost in BRL paid to Namecheap before markup and fixed fee */
  namecheapCostBrl?: number;
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from atlas-hosting directory:
```bash
npx tsc --noEmit
```
Expected: no errors related to this type.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db/schema/tables/invoice.ts
git commit -m "feat: add namecheapCostBrl to DomainRegisterInvoiceOptions"
```

---

## Task 2: atlas-hosting — Save `namecheapCostBrl` in domain invoice creation

**Files:**
- Modify: `atlas-hosting/src/app/actions.ts` (lines ~673–775)

The existing logic calculates `priceInBrl` in two paths (premium and standard domain). In both paths, after `currencyConversion.convert()`, the raw BRL value is available before the markup is applied.

- [ ] **Step 1: Capture base BRL cost — premium domain path (line ~681)**

Find this block (around line 675–688):
```typescript
if (namecheapResult.IsPremiumName && (namecheapResult.PremiumRegistrationPrice ?? 0) > 0) {
  const basePriceUSD = namecheapResult.PremiumRegistrationPrice ?? 0;
  console.log(`[INVOICE] Usando PREÇO PREMIUM: $${basePriceUSD}`);
  priceInBrl = await currencyConversion.convert({
    from: "usd",
    to: "brl",
    amount: basePriceUSD,
  });
  const targetYears = parseInt(yearStr, 10);
  const fixedFee = Number(process.env.DOMAIN_FIXED_FEE) || 4;
  priceInBrl = (priceInBrl * fee) + (fixedFee * targetYears);
```

Replace with:
```typescript
if (namecheapResult.IsPremiumName && (namecheapResult.PremiumRegistrationPrice ?? 0) > 0) {
  const basePriceUSD = namecheapResult.PremiumRegistrationPrice ?? 0;
  console.log(`[INVOICE] Usando PREÇO PREMIUM: $${basePriceUSD}`);
  const baseUsdAsBrl = await currencyConversion.convert({
    from: "usd",
    to: "brl",
    amount: basePriceUSD,
  });
  const targetYears = parseInt(yearStr, 10);
  const fixedFee = Number(process.env.DOMAIN_FIXED_FEE) || 4;
  namecheapCostBrl = baseUsdAsBrl * targetYears;
  priceInBrl = (baseUsdAsBrl * fee) + (fixedFee * targetYears);
```

- [ ] **Step 2: Capture base BRL cost — standard domain path (line ~743)**

Find this block (around line 743–751):
```typescript
priceInBrl = await currencyConversion.convert({
  from: "usd",
  to: "brl",
  amount: totalUSD,
});
const envFixedFee = process.env.DOMAIN_FIXED_FEE;
const fixedFee = envFixedFee !== undefined ? Number(envFixedFee) : 4;
priceInBrl = (priceInBrl * fee) + (fixedFee * targetYears);
```

Replace with:
```typescript
const baseUsdAsBrl = await currencyConversion.convert({
  from: "usd",
  to: "brl",
  amount: totalUSD,
});
const envFixedFee = process.env.DOMAIN_FIXED_FEE;
const fixedFee = envFixedFee !== undefined ? Number(envFixedFee) : 4;
namecheapCostBrl = baseUsdAsBrl;
priceInBrl = (baseUsdAsBrl * fee) + (fixedFee * targetYears);
```

- [ ] **Step 3: Declare `namecheapCostBrl` variable before the if/else block**

Find where `priceInBrl` is declared (a `let priceInBrl = 0` or similar). Add the new variable next to it:
```typescript
let priceInBrl = 0;
let namecheapCostBrl = 0;
```

- [ ] **Step 4: Add `namecheapCostBrl` to the invoice metadata in the DB insert (line ~758)**

Find the `db.insert(pgInvoice).values({...})` block:
```typescript
metadata: {
  years: yearStr,
  whoisguard,
  guestCheckout: isGuestCheckout || undefined,
  guestPassword: guestPassword || undefined,
},
```

Replace with:
```typescript
metadata: {
  years: yearStr,
  whoisguard,
  guestCheckout: isGuestCheckout || undefined,
  guestPassword: guestPassword || undefined,
  namecheapCostBrl: namecheapCostBrl > 0 ? namecheapCostBrl : undefined,
},
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat: capture namecheapCostBrl in domain invoice metadata"
```

---

## Task 3: atlas-hosting — Create internal report API route

**Files:**
- Create: `atlas-hosting/src/app/api/internal/report/route.ts`

This endpoint returns aggregated financial data for the simpay admin report. Auth: validates `x-internal-token` header against `SIMPAY_INTERNAL_TOKEN` env var.

- [ ] **Step 1: Add `SIMPAY_INTERNAL_TOKEN` to atlas-hosting `.env`**

Open `atlas-hosting/.env` and add:
```
SIMPAY_INTERNAL_TOKEN=your-shared-secret-here
```
Use the same value as `API_MACHINE_INTERNAL_TOKEN` in back-simpay's `.env`.

- [ ] **Step 2: Create the route file**

Create `atlas-hosting/src/app/api/internal/report/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pgInvoice } from "@/lib/db/schema/tables/invoice";
import { pgAffiliateCommission } from "@/lib/db/schema/tables/affiliate";
import { pgWithdrawalRequests } from "@/lib/db/schema/tables/system";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { DomainRegisterInvoiceOptions } from "@/lib/db/schema/tables/invoice";

function authError() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  const token = request.headers.get("x-internal-token");
  const expected = process.env.SIMPAY_INTERNAL_TOKEN;
  if (!expected || token !== expected) return authError();

  const { searchParams } = new URL(request.url);
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");

  const startDate = startDateStr ? new Date(startDateStr) : new Date(0);
  const endDate = endDateStr ? new Date(endDateStr + "T23:59:59.999Z") : new Date();

  // Domain invoices paid in period (filter by dueDate as proxy for creation date)
  const domainInvoices = await db
    .select({ amount: pgInvoice.amount, metadata: pgInvoice.metadata })
    .from(pgInvoice)
    .where(
      and(
        eq(pgInvoice.type, "domain"),
        eq(pgInvoice.status, "paid"),
        gte(pgInvoice.dueDate, startDate),
        lte(pgInvoice.dueDate, endDate),
      ),
    );

  const domainTotalRevenue = domainInvoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const domainTotalNamecheapCost = domainInvoices.reduce((s, i) => {
    const meta = i.metadata as DomainRegisterInvoiceOptions | null;
    return s + (meta?.namecheapCostBrl ?? 0);
  }, 0);

  // VPS invoices paid in period
  const vpsInvoices = await db
    .select({ amount: pgInvoice.amount })
    .from(pgInvoice)
    .where(
      and(
        eq(pgInvoice.type, "vps"),
        eq(pgInvoice.status, "paid"),
        gte(pgInvoice.dueDate, startDate),
        lte(pgInvoice.dueDate, endDate),
      ),
    );

  const vpsTotalRevenue = vpsInvoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const vpsTotalContaboCost = vpsTotalRevenue / 2;

  // Affiliate commissions — current available balance (not period-filtered)
  const availableResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${pgAffiliateCommission.commissionAmount}), 0)` })
    .from(pgAffiliateCommission)
    .where(eq(pgAffiliateCommission.status, "available"));
  const totalAvailable = Number(availableResult[0]?.total ?? 0);

  // Commissions generated in period (custo afiliado)
  const commissionInPeriodResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${pgAffiliateCommission.commissionAmount}), 0)` })
    .from(pgAffiliateCommission)
    .where(
      and(
        gte(pgAffiliateCommission.createdAt, startDate),
        lte(pgAffiliateCommission.createdAt, endDate),
      ),
    );
  const commissionGeneratedInPeriod = Number(commissionInPeriodResult[0]?.total ?? 0);

  // Withdrawal requests
  const pendingCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pgWithdrawalRequests)
    .where(eq(pgWithdrawalRequests.status, "pending"));

  const approvedInPeriod = await db
    .select({
      count: sql<number>`COUNT(*)`,
      totalAmount: sql<number>`COALESCE(SUM(${pgWithdrawalRequests.amount}), 0)`,
      totalFee: sql<number>`COALESCE(SUM(${pgWithdrawalRequests.fee}), 0)`,
    })
    .from(pgWithdrawalRequests)
    .where(
      and(
        eq(pgWithdrawalRequests.status, "approved"),
        gte(pgWithdrawalRequests.updatedAt, startDate),
        lte(pgWithdrawalRequests.updatedAt, endDate),
      ),
    );

  // Withdrawn total in period (what affiliates already received)
  const totalWithdrawn = Number(approvedInPeriod[0]?.totalAmount ?? 0);

  return NextResponse.json({
    domains: {
      totalRevenue: domainTotalRevenue,
      totalNamecheapCost: domainTotalNamecheapCost,
      count: domainInvoices.length,
    },
    vps: {
      totalRevenue: vpsTotalRevenue,
      totalContaboCost: vpsTotalContaboCost,
      count: vpsInvoices.length,
    },
    affiliates: {
      totalAvailable,
      totalWithdrawn,
      commissionGeneratedInPeriod,
    },
    withdrawals: {
      pendingCount: Number(pendingCount[0]?.count ?? 0),
      approvedInPeriodCount: Number(approvedInPeriod[0]?.count ?? 0),
      approvedInPeriodFeeSum: Number(approvedInPeriod[0]?.totalFee ?? 0),
    },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors. Fix any import path issues.

- [ ] **Step 4: Test the endpoint manually**

Start atlas-hosting dev server (`npm run dev` from atlas-hosting dir), then:
```bash
curl -H "x-internal-token: your-shared-secret-here" \
  "http://localhost:3001/api/internal/report?startDate=2026-05-01&endDate=2026-05-14"
```
Expected: JSON with `domains`, `vps`, `affiliates`, `withdrawals` keys.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/internal/report/route.ts .env
git commit -m "feat: add internal report API endpoint for simpay integration"
```

---

## Task 4: back-simpay — Add `GET /admin/relatorios/atlas-consolidado` endpoint

**Files:**
- Modify: `back-simpay/src/presentation/controllers/admin.controller.ts` (append after line 5789)

**Env vars needed in back-simpay `.env`:** `ATLAS_LIQUIDEZ`, `ATLAS_TAXA_FIXA_TRANSACAO`, `ATLAS_TAXA_CASHBACK`, `ATLAS_TAXA_SAQUE_FIXA`, `ATLAS_HOSTING_URL`, `API_MACHINE_INTERNAL_TOKEN`

(Most are already present. Verify `ATLAS_LIQUIDEZ`, `ATLAS_TAXA_FIXA_TRANSACAO`, `ATLAS_TAXA_CASHBACK` exist.)

- [ ] **Step 1: Add the new endpoint method at the end of the AdminController class**

At the end of the `AdminController` class (after the last method at line ~5789), add:

```typescript
@Get('relatorios/atlas-consolidado')
@UseGuards(AdminGuard)
async getAtlasConsolidado(
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
) {
  const atlasUserId = await resolveBySlugOrEnv(this.prisma, 'ATLAS_USER_ID', ['atlas']);
  if (!atlasUserId) {
    return { error: 'ATLAS_USER_ID not configured' };
  }

  // ─── Atlas transactions from simpay DB ───────────────────────────────
  const where: any = { userId: atlasUserId, status: 'COMPLETED' };
  if (startDate) {
    where.createdAt = { ...where.createdAt, gte: parseYmdSp(startDate).startOf('day').toDate() };
  }
  if (endDate) {
    where.createdAt = { ...where.createdAt, lte: parseYmdSp(endDate).endOf('day').toDate() };
  }

  const txs = await this.prisma.transaction.findMany({
    where,
    select: { amount: true },
  });

  const qtdTransacoes = txs.length;
  const receitaTotalAtlas = txs.reduce((s, t) => s + Number(t.amount), 0);

  const LIQUIDEZ = parseFloat(process.env.ATLAS_LIQUIDEZ ?? '0.91');
  const TAXA_FIXA = parseFloat(process.env.ATLAS_TAXA_FIXA_TRANSACAO ?? '1.00');
  const TAXA_CASHBACK = parseFloat(process.env.ATLAS_TAXA_CASHBACK ?? '3.00');
  const TAXA_SAQUE_FIXA = parseFloat(process.env.ATLAS_TAXA_SAQUE_FIXA ?? '2.00');

  const taxaSimInt = receitaTotalAtlas * (1 - LIQUIDEZ) + (TAXA_FIXA + TAXA_CASHBACK) * qtdTransacoes;
  const taxaAdquirente = TAXA_FIXA * qtdTransacoes;
  const custoCashback = TAXA_CASHBACK * qtdTransacoes;

  // ─── Atlas-hosting internal API ──────────────────────────────────────
  const atlasBaseUrl = String(process.env.ATLAS_HOSTING_URL ?? '').replace(/\/+$/, '');
  const internalToken = process.env.API_MACHINE_INTERNAL_TOKEN ?? '';

  let atlasData: {
    domains: { totalRevenue: number; totalNamecheapCost: number; count: number };
    vps: { totalRevenue: number; totalContaboCost: number; count: number };
    affiliates: { totalAvailable: number; totalWithdrawn: number; commissionGeneratedInPeriod: number };
    withdrawals: { pendingCount: number; approvedInPeriodCount: number; approvedInPeriodFeeSum: number };
  } | null = null;

  if (atlasBaseUrl) {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const resp = await fetch(`${atlasBaseUrl}/api/internal/report?${params.toString()}`, {
      headers: { 'x-internal-token': internalToken },
    }).catch(() => null);

    if (resp?.ok) {
      atlasData = await resp.json().catch(() => null);
    }
  }

  const custoDominio = atlasData?.domains.totalNamecheapCost ?? 0;
  const custoHospedagem = atlasData?.vps.totalContaboCost ?? 0;
  const lucroAfiliado = atlasData?.affiliates.totalWithdrawn ?? 0;
  const totalRepasseAfiliado = atlasData?.affiliates.totalAvailable ?? 0;
  const custoAfiliadoPeriodo = atlasData?.affiliates.commissionGeneratedInPeriod ?? 0;
  const saquePendente = atlasData?.withdrawals.pendingCount ?? 0;
  const qtdSaquesAprovados = atlasData?.withdrawals.approvedInPeriodCount ?? 0;
  const lucroSimpayDeSaque = qtdSaquesAprovados * TAXA_SAQUE_FIXA;

  const receitaLiquidaSimintpay =
    taxaSimInt - taxaAdquirente - custoCashback + lucroSimpayDeSaque;

  const lucroLiquidoDominio =
    (atlasData?.domains.totalRevenue ?? 0) - custoDominio;

  const lucroLiquidoVps = custoHospedagem; // revenue/2 - cost(revenue/2) = revenue/2

  const receitaBrutaAtlas =
    (atlasData?.domains.totalRevenue ?? 0) + (atlasData?.vps.totalRevenue ?? 0);

  const receitaLiquidaAtlas =
    receitaBrutaAtlas - taxaSimInt - custoDominio - custoHospedagem - custoAfiliadoPeriodo;

  const roiSimintpay =
    receitaTotalAtlas > 0 ? (receitaLiquidaSimintpay / receitaTotalAtlas) * 100 : 0;

  return {
    // Custos
    taxaSimInt,
    taxaAdquirente,
    custoCashback,
    custoDominio,
    custoHospedagem,
    // Receitas líquidas
    receitaLiquidaSimintpay,
    lucroLiquidoDominio,
    lucroLiquidoVps,
    // Afiliados
    lucroAfiliado,
    totalRepasseAfiliado,
    lucroSimpayDeSaque,
    // Atlas consolidado
    receitaLiquidaAtlas,
    saquePendente,
    roiSimintpay,
    // Suporte
    receitaTotalAtlas,
    qtdTransacoes,
    domainCount: atlasData?.domains.count ?? 0,
    vpsCount: atlasData?.vps.count ?? 0,
    atlasApiAvailable: atlasData !== null,
  };
}
```

> **Note on `lucroLiquidoVps`:** VPS revenue is sold for 2× contabo cost. Atlas receives `vps.totalRevenue`, pays `vps.totalContaboCost` (= revenue/2) to contabo. After simpay takes its fee from `taxaSimInt`, the VPS contribution to atlas profit is `vps.totalRevenue - vps.totalContaboCost = revenue/2`. Here `lucroLiquidoVps = custoHospedagem` because `custoHospedagem = revenue/2`, which IS the profit. If you want atlas VPS profit before simpay fee, use `atlasData.vps.totalRevenue - custoHospedagem`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Test the endpoint**

Start back-simpay dev server. Use an admin JWT token:
```bash
curl -H "Authorization: Bearer <admin-token>" \
  "http://localhost:3000/admin/relatorios/atlas-consolidado?startDate=2026-05-01&endDate=2026-05-14"
```
Expected: JSON with all 14+ keys, `atlasApiAvailable: true` if atlas-hosting is running.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/controllers/admin.controller.ts
git commit -m "feat: add GET /admin/relatorios/atlas-consolidado endpoint"
```

---

## Task 5: front-simpay — Add endpoint config

**Files:**
- Modify: `front-simpay/src/services/api/endpoints.ts`

- [ ] **Step 1: Add `atlasConsolidado` to the relatorios section**

Open `front-simpay/src/services/api/endpoints.ts`. Find the `relatorios` block (around line 72):
```typescript
relatorios: {
  dashboard: "/relatorios/dashboard",
  ...
  mensal: "/admin/relatorios/mensal",
},
```

Add after `mensal`:
```typescript
  atlasConsolidado: "/admin/relatorios/atlas-consolidado",
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/services/api/endpoints.ts
git commit -m "feat: add atlasConsolidado endpoint config"
```

---

## Task 6: front-simpay — Add Atlas cards to the report page

**Files:**
- Modify: `front-simpay/src/app/(dashboard)/relatorio/page.tsx`

The page already has `useQuery` and `MetricCard`. Add a new query and a new section of cards at the bottom.

- [ ] **Step 1: Add the `atlasConsolidado` useQuery hook**

In `page.tsx`, find the last `useQuery` call (around line 200+). After it, add:

```typescript
const { data: atlasConsolidado, isLoading: isLoadingAtlas } = useQuery({
  queryKey: [
    "atlasConsolidado",
    formatQueryDate(effectiveDateRange.start),
    formatQueryDate(effectiveDateRange.end),
  ],
  queryFn: async () => {
    return api.get<{
      taxaSimInt: number;
      taxaAdquirente: number;
      custoCashback: number;
      custoDominio: number;
      custoHospedagem: number;
      receitaLiquidaSimintpay: number;
      lucroLiquidoDominio: number;
      lucroLiquidoVps: number;
      lucroAfiliado: number;
      totalRepasseAfiliado: number;
      lucroSimpayDeSaque: number;
      receitaLiquidaAtlas: number;
      saquePendente: number;
      roiSimintpay: number;
      receitaTotalAtlas: number;
      qtdTransacoes: number;
      atlasApiAvailable: boolean;
    }>(endpoints.relatorios.atlasConsolidado, {
      query: {
        startDate: formatQueryDate(effectiveDateRange.start) ?? undefined,
        endDate: formatQueryDate(effectiveDateRange.end) ?? undefined,
      },
    });
  },
});
```

- [ ] **Step 2: Add the Atlas cards section in the JSX**

Find the end of the existing cards section (the closing `</div>` of the main metrics grid). After it, add:

```tsx
{/* ── Atlas Detalhado ─────────────────────────────────────────────── */}
<div className="mt-8">
  <h2 className="text-base font-semibold mb-4 text-orange-600 dark:text-orange-400">
    Relatório Detalhado Atlas
  </h2>
  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
    <MetricCard
      label="Taxa Sim Int"
      tooltip="Taxa cobrada dos clientes Atlas (MDR% × bruto + R$4 por transação)"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.taxaSimInt ?? 0)}
      icon={Zap}
      iconClassName="text-orange-600 bg-orange-50 dark:bg-orange-950/30 dark:text-orange-400"
    />
    <MetricCard
      label="Taxa Adquirente DOM"
      tooltip="R$1 fixo por transação Atlas pago à DOM"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.taxaAdquirente ?? 0)}
      icon={Wallet}
      iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
      valueClassName="text-red-600 dark:text-red-400"
    />
    <MetricCard
      label="Custo Cashback"
      tooltip="R$3 por transação Atlas"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.custoCashback ?? 0)}
      icon={TrendingDown}
      iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
      valueClassName="text-red-600 dark:text-red-400"
    />
    <MetricCard
      label="Custo Domínio"
      tooltip="Custo real pago à Namecheap (sem markup)"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.custoDominio ?? 0)}
      icon={TrendingDown}
      iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
      valueClassName="text-red-600 dark:text-red-400"
    />
    <MetricCard
      label="Custo Hospedagem"
      tooltip="Custo real na Contabo (metade do valor vendido)"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.custoHospedagem ?? 0)}
      icon={TrendingDown}
      iconClassName="text-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400"
      valueClassName="text-red-600 dark:text-red-400"
    />
    <MetricCard
      label="Receita Líquida SimIntPay"
      tooltip="Taxa Sim Int − Taxa DOM − Custo Cashback + Lucro Saque"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.receitaLiquidaSimintpay ?? 0)}
      icon={TrendingUp}
      iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
      valueClassName={(atlasConsolidado?.receitaLiquidaSimintpay ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
    />
    <MetricCard
      label="Lucro Líq. Domínio"
      tooltip="Receita domínios − custo Namecheap"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.lucroLiquidoDominio ?? 0)}
      icon={TrendingUp}
      iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
      valueClassName={(atlasConsolidado?.lucroLiquidoDominio ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
    />
    <MetricCard
      label="Lucro Líq. VPS"
      tooltip="Receita VPS − custo Contabo (sempre metade da receita)"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.lucroLiquidoVps ?? 0)}
      icon={TrendingUp}
      iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
      valueClassName="text-green-600 dark:text-green-400"
    />
    <MetricCard
      label="Lucro Afiliado"
      tooltip="Total sacado pelos afiliados Atlas no período"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.lucroAfiliado ?? 0)}
      icon={Wallet}
      iconClassName="text-sky-600 bg-sky-50 dark:bg-sky-950/30 dark:text-sky-400"
    />
    <MetricCard
      label="Total Repasse Afiliado"
      tooltip="Saldo atual nas carteiras dos afiliados Atlas (não sacado)"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.totalRepasseAfiliado ?? 0)}
      icon={Wallet}
      iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
    />
    <MetricCard
      label="Lucro SimIntPay — Saque"
      tooltip="R$2 por saque aprovado de afiliado Atlas no período"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.lucroSimpayDeSaque ?? 0)}
      icon={TrendingUp}
      iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
      valueClassName="text-green-600 dark:text-green-400"
    />
    <MetricCard
      label="Receita Líquida Atlas"
      tooltip="(Dom + VPS) − taxa SimIntPay − custos domínio − custos hospedagem − comissões afiliados"
      value={isLoadingAtlas ? "Carregando..." : formatBRL(atlasConsolidado?.receitaLiquidaAtlas ?? 0)}
      icon={TrendingUp}
      iconClassName="text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400"
      valueClassName={(atlasConsolidado?.receitaLiquidaAtlas ?? 0) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
    />
    <MetricCard
      label="Saque Pendente"
      tooltip="Quantidade de saques de afiliados Atlas aguardando aprovação"
      value={isLoadingAtlas ? "Carregando..." : (atlasConsolidado?.saquePendente ?? 0).toLocaleString("pt-BR")}
      icon={Wallet}
      iconClassName="text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30 dark:text-yellow-400"
      valueClassName="text-yellow-600 dark:text-yellow-400"
    />
    <MetricCard
      label="ROI SimIntPay"
      tooltip="Receita líquida SimIntPay ÷ receita total Atlas × 100%"
      value={isLoadingAtlas ? "Carregando..." : `${(atlasConsolidado?.roiSimintpay ?? 0).toFixed(2)}%`}
      icon={TrendingUp}
      iconClassName="text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400"
      valueClassName={(atlasConsolidado?.roiSimintpay ?? 0) >= 0 ? "text-purple-600 dark:text-purple-400" : "text-red-600 dark:text-red-400"}
    />
  </div>
</div>
```

> **Note:** `TrendingDown`, `TrendingUp`, `Wallet`, `Zap` must be imported from `lucide-react`. Check existing imports at the top of the file and add any missing ones.

- [ ] **Step 3: Check and fix imports at top of page.tsx**

Verify that `TrendingDown`, `TrendingUp`, `Wallet`, `Zap` are already imported. If not, add them to the existing `lucide-react` import line:
```typescript
import { TrendingUp, TrendingDown, Wallet, Zap, /* existing icons */ } from "lucide-react";
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Test in browser**

Start front-simpay dev server. Navigate to `http://localhost:3000/relatorio?startDate=2026-05-01&endDate=2026-05-14`. Scroll to bottom. Verify "Relatório Detalhado Atlas" section appears with 14 cards. All should load (not show "Carregando..." indefinitely).

- [ ] **Step 6: Commit**

```bash
git add src/services/api/endpoints.ts src/app/(dashboard)/relatorio/page.tsx
git commit -m "feat: add 14 atlas financial metric cards to report page"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec requirement | Task |
|-----------------|------|
| Taxa Sim Int card | Task 4 (calc) + Task 6 (UI) |
| Taxa Adquirente card | Task 4 + Task 6 |
| Custo Cashback card | Task 4 + Task 6 |
| Custos do Domínio card | Task 2 (save cost) + Task 3 (API) + Task 4 + Task 6 |
| Custo Hospedagem card | Task 3 (API, amount/2) + Task 4 + Task 6 |
| Receita Líquida SimIntPay card | Task 4 + Task 6 |
| Lucro Líq. Domínio card | Task 3 + Task 4 + Task 6 |
| Lucro Líq. VPS card | Task 3 + Task 4 + Task 6 |
| Lucro Afiliado card | Task 3 + Task 4 + Task 6 |
| Total Repasse Afiliado card | Task 3 + Task 4 + Task 6 |
| Lucro SimIntPay Saque card | Task 3 + Task 4 + Task 6 |
| Receita Líquida Atlas card | Task 3 + Task 4 + Task 6 |
| Saque Pendente card | Task 3 + Task 4 + Task 6 |
| ROI SimIntPay card | Task 4 + Task 6 |
| Save namecheapCostBrl in invoice | Task 1 + Task 2 |
| atlas-hosting internal API | Task 3 |
| back-simpay consolidated endpoint | Task 4 |
| front-simpay endpoint config | Task 5 |
| Auth via x-internal-token | Task 3 + Task 4 |

All 14 cards covered. ✓

### Potential Issues

1. **`pgInvoice.dueDate` filter**: Using dueDate (≈ createDate + 24h) as date proxy. Acceptable for monthly reporting; note 24h offset in comments.

2. **Icons**: Task 6 uses `TrendingDown` — verify it exists in `lucide-react` installed version. If not, substitute `ArrowDown`.

3. **`resolveBySlugOrEnv`**: Already used in admin.controller at lines 4591 and 4822 — use same import/call pattern.

4. **`parseYmdSp`**: Already used in admin.controller at lines 4826-4827 — same pattern.

5. **`AdminGuard`**: Check which guard is used on other `/admin/relatorios/*` endpoints and use the same one.

6. **Atlas API not available**: If `atlasBaseUrl` is empty or atlas is down, `atlasData` is `null`. All atlas-sourced values default to `0`, which is safe. `atlasApiAvailable: false` signals this to the frontend (optional: show warning).
