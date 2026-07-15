import { Injectable, Inject } from '@nestjs/common';
import dayjs from 'dayjs';
import type { IPaymentGateway, DomTransactionItem } from '../../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { platformTaxaTagFromText, resolveDomFeeReais } from '../../helpers/dom-fee-estimate.helper';
import { isPixLikePayment } from '../../helpers/platform-fee-split.helper';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

function platformTagFromKeywords(text: string | undefined | null): string {
  const t = String(text ?? '').toLowerCase();
  if (t.includes('areaflix') || t.includes('área flix') || t.includes('area flix')) return 'AREAFLIX';
  if (t.includes('pagatg') || t.includes('paga tg')) return 'PAGATG';
  if (t.includes('ebook') || t.includes('e-book')) return 'EBOOK';
  if (t.includes('renovada')) return 'RENOVADA';
  if (t.includes('bosque') || t.includes('ibb')) return 'BOSQUE';
  if (t.includes('revalida')) return 'REVALIDA';
  if (t.includes('marketing raiz') || t.includes('marketing-raiz')) return 'MARKETING-RAIZ';
  if (t.includes('controle-motorista') || t.includes('controle motorista') || t.includes('controle de motorista')) return 'CONTROLE-MOTORISTA';
  if (t.includes('controle-patrimonial') || t.includes('controle patrimonial') || t.includes('controle de patrimonial')) return 'CONTROLE-PATRIMONIAL';
  if (t.includes('atlas') || t.includes('atlashosting')) return 'ATLAS';
  if (t.includes('frendz')) return 'FRENDZ';
  return 'GLOBAL';
}

/** Extrai o subscriptionLinkId de cod_external no padrão sub-link-pix-{uuid}-{timestamp}. */
function extractSubLinkId(codExternal: string): string | null {
  const m = codExternal.match(/^sub-link-pix-([0-9a-f-]{36})-\d+$/i);
  return m ? m[1] : null;
}

/** Extrai o paymentLinkId de cod_external no padrão pix-link-{uuid}-{timestamp}. */
function extractPaymentLinkId(codExternal: string): string | null {
  const m = codExternal.match(/^pix-link-([0-9a-f-]{36})-\d+$/i);
  return m ? m[1] : null;
}

export interface ListDomTransactionsDirectInput {
  page?: number;
  limit?: number;
  status?: string;
  begin_date?: string;
  end_date?: string;
  payment_method?: string;
}

@Injectable()
export class ListDomTransactionsDirectUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: ListDomTransactionsDirectInput) {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) {
      throw new Error('DOM_TOKEN não configurado no .env');
    }

    // A API DOM exige datas obrigatoriamente — padrão: últimos 90 dias
    const end_date   = input.end_date   ?? dayjs().format('YYYY-MM-DD');
    const begin_date = input.begin_date ?? dayjs().subtract(90, 'day').format('YYYY-MM-DD');

    // A API DOM ignora o `limit` e pagina em blocos de ~100 (mesmo comportamento
    // documentado em `listSubscriptions`). O admin usa páginas de `limit` (ex.: 20),
    // então mapeamos a paginação do admin para os blocos de 100 do DOM — senão a
    // página 2 do admin pedia a página 2 do DOM (registros 100-199) e vinha vazia,
    // mesmo com `total` indicando mais páginas.
    const DOM_PER_PAGE = 100;
    const adminPage = Math.max(1, input.page ?? 1);
    const requestedCount = Math.max(1, input.limit ?? 50);
    const globalStart = (adminPage - 1) * requestedCount;
    const globalEnd = globalStart + requestedCount;
    const domPageStart = Math.floor(globalStart / DOM_PER_PAGE) + 1;
    const domPageEnd = Math.floor(Math.max(globalEnd - 1, 0) / DOM_PER_PAGE) + 1;

    let allRaw: DomTransactionItem[] = [];
    let total: number | undefined;
    for (let domPage = domPageStart; domPage <= domPageEnd; domPage++) {
      const res = await this.gateway.listDomTransactions(domToken, {
        page: domPage,
        limit: DOM_PER_PAGE,
        status: input.status,
        begin_date,
        end_date,
      });
      if (domPage === domPageStart) total = res.total;
      const arr = res.transactions ?? [];
      allRaw = allRaw.concat(arr);
      if (arr.length < DOM_PER_PAGE) break; // fim dos dados — evita buscar páginas vazias
    }

    const localStart = globalStart - (domPageStart - 1) * DOM_PER_PAGE;
    const rawTxs = allRaw.slice(localStart, localStart + requestedCount);

    // Enriquece pelo banco: cod_external = Transaction.id (pix-plan) ou domPaymentId (outros).
    // netAmount é gravado na criação (amount × LIQUIDEZ) e nunca muda — snapshot imutável.
    const codExternals = rawTxs.map((t) => String(t.cod_external ?? '')).filter(Boolean);
    const domIds = rawTxs.map((t) => String(t.id ?? '')).filter(Boolean);
    const dbTxs = codExternals.length > 0 || domIds.length > 0
      ? await this.prisma.transaction.findMany({
          where: { OR: [{ id: { in: codExternals } }, { domPaymentId: { in: domIds } }] },
          select: { id: true, domPaymentId: true, description: true, netAmount: true, paymentLinkId: true },
        })
      : [];
    const dbByCodExternal = new Map(dbTxs.map((t) => [t.id, t]));
    const dbByDomId = new Map(dbTxs.map((t) => [t.domPaymentId ?? '', t]));

    // Resolve platformTag para payment link PIX via cod_external (pix-link-{linkId}-{ts}) e via Transaction.paymentLinkId
    const payLinkIdsByCodExternal = new Map<string, string>();
    for (const ce of codExternals) {
      const linkId = extractPaymentLinkId(ce);
      if (linkId) payLinkIdsByCodExternal.set(ce, linkId);
    }
    const payLinkTagByCodExternal = new Map<string, string>();
    const payLinkTagByPaymentLinkId = new Map<string, string>();
    const allPayLinkIds = [
      ...new Set([
        ...[...payLinkIdsByCodExternal.values()],
        ...dbTxs.map((t) => (t as any).paymentLinkId as string | null).filter(Boolean) as string[],
      ]),
    ];
    if (allPayLinkIds.length > 0) {
      const payLinks = await this.prisma.paymentLink.findMany({
        where: { id: { in: allPayLinkIds } },
        select: { id: true, plataformas: true },
      });
      for (const pl of payLinks) {
        const tag = ((pl.plataformas as string[])?.[0] ?? '').toUpperCase();
        if (tag && tag !== 'GLOBAL') payLinkTagByPaymentLinkId.set(pl.id, tag);
      }
      for (const [ce, linkId] of payLinkIdsByCodExternal) {
        const tag = payLinkTagByPaymentLinkId.get(linkId);
        if (tag) payLinkTagByCodExternal.set(ce, tag);
      }
    }

    // Resolve platformTag para subscription link PIX via cod_external (sub-link-pix-{linkId}-{ts})
    const subLinkIdsByCodExternal = new Map<string, string>();
    for (const ce of codExternals) {
      const linkId = extractSubLinkId(ce);
      if (linkId) subLinkIdsByCodExternal.set(ce, linkId);
    }
    const subLinkTagByCodExternal = new Map<string, string>();
    if (subLinkIdsByCodExternal.size > 0) {
      const linkIds = [...new Set(subLinkIdsByCodExternal.values())];
      const subLinks = await this.prisma.subscriptionLink.findMany({
        where: { id: { in: linkIds } },
        select: { id: true, platformTag: true, plataformas: true },
      });
      const tagById = new Map(subLinks.map((l) => [
        l.id,
        ((l.platformTag || (l.plataformas as string[])?.[0]) ?? '').toUpperCase() || 'GLOBAL',
      ]));
      for (const [ce, linkId] of subLinkIdsByCodExternal) {
        const tag = tagById.get(linkId);
        if (tag && tag !== 'GLOBAL') subLinkTagByCodExternal.set(ce, tag);
      }
    }

    const transactions = rawTxs.map((tx) => {
      const amount = Number(tx.amount ?? 0);
      const dbRecord = dbByCodExternal.get(String(tx.cod_external ?? '')) ?? dbByDomId.get(String(tx.id ?? ''));

      /** Plataforma: prioridade → [TENANT:TAG] no produto → DB description → SubscriptionLink.platformTag → keywords → GLOBAL. */
      let tenantTag = platformTaxaTagFromText(tx.product_first ?? undefined);
      if (tenantTag === 'GLOBAL' && dbRecord?.description) {
        tenantTag = platformTaxaTagFromText(dbRecord.description);
      }
      if (tenantTag === 'GLOBAL') {
        const subLinkTag = subLinkTagByCodExternal.get(String(tx.cod_external ?? ''));
        if (subLinkTag) tenantTag = subLinkTag;
      }
      if (tenantTag === 'GLOBAL') {
        const payLinkTagByCe = payLinkTagByCodExternal.get(String(tx.cod_external ?? ''));
        if (payLinkTagByCe) tenantTag = payLinkTagByCe;
      }
      if (tenantTag === 'GLOBAL' && dbRecord && (dbRecord as any).paymentLinkId) {
        const payLinkTag = payLinkTagByPaymentLinkId.get((dbRecord as any).paymentLinkId);
        if (payLinkTag) tenantTag = payLinkTag;
      }
      const displayTag = tenantTag !== 'GLOBAL'
        ? tenantTag
        : platformTagFromKeywords(tx.product_first ?? undefined);

      const fixedTx = getPlatformTaxaEffective(tenantTag, 'TAXA_FIXA_TRANSACAO', PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO);
      const fixedCashback = getPlatformTaxaEffective(tenantTag, 'TAXA_CASHBACK', PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK);
      const fixedFees = fixedTx + fixedCashback;
      const mdr = resolveDomFeeReais({
        amountReais: amount,
        paymentMethod: tx.payment_method,
        installments: tx.installments,
        mdrFromGateway: tx.mdr_value,
        domFeeFromGateway: tx.dom_fee,
        tenantTag,
      });
      const L = getPlatformTaxaEffective(tenantTag, 'LIQUIDEZ', 0.91);
      const pix = isPixLikePayment(tx.payment_method);

      let totalFee: number;
      let liquidAmount: number;
      let taxaVendedor: number;
      /** Taxa DOM sempre com 2 casas (exibição e soma da linha). */
      let taxaDom2: number;

      if (pix) {
        const mdr2 = Number(mdr.toFixed(2));
        taxaDom2 = mdr2;

        // Sempre usa LIQUIDEZ nominal para exibição — o storedNet pode refletir apenas o
        // liquid_amount do DOM (só MDR 2%), não a margem de plataforma (1 − LIQUIDEZ).
        taxaVendedor = Number(Math.max(0, amount * (1 - L)).toFixed(2));

        const platformFee = taxaVendedor + fixedFees;
        totalFee = Number((mdr2 + platformFee).toFixed(2));
        liquidAmount = Number((amount - totalFee).toFixed(2));
      } else {
        const mdr2 = Number(mdr.toFixed(2));
        taxaDom2 = mdr2;

        // CC: DOM reports only its own MDR in fee_total — Simintpay's LIQUIDEZ margin
        // is not included. Apply same LIQUIDEZ-based formula as PIX.
        taxaVendedor = Number(Math.max(0, amount * (1 - L)).toFixed(2));

        const platformFee = taxaVendedor + fixedFees;
        totalFee = Number((mdr2 + platformFee).toFixed(2));
        liquidAmount = Number((amount - totalFee).toFixed(2));
      }

      /** P&L do master: lucro da Taxa Vendedor menos custos DOM (MDR + fixas + cashback). */
      const lucroMaster = Number(
        (taxaVendedor - taxaDom2 - Number(fixedTx.toFixed(2)) - Number(fixedCashback.toFixed(2))).toFixed(2),
      );

      return {
        ...tx,
        tenant_tag: displayTag,
        fee_total: totalFee,
        liquid_amount: liquidAmount,
        valor_bruto_venda: Number(amount.toFixed(2)),
        taxa_dom: taxaDom2,
        taxa_vendedor: taxaVendedor,
        taxa_fixa_transacao: Number(fixedTx.toFixed(2)),
        taxa_cashback: Number(fixedCashback.toFixed(2)),
        valor_liquido_vendedor: liquidAmount,
        lucro_master: lucroMaster,
      };
    });

    return {
      transactions,
      total: total ?? transactions.length,
    };
  }
}
