import { Injectable, Inject } from '@nestjs/common';
import dayjs from 'dayjs';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
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
  if (t.includes('comunidade') || t.includes('community')) return 'COMUNIDADE';
  return 'GLOBAL';
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

    const result = await this.gateway.listDomTransactions(domToken, {
      page: input.page ?? 1,
      limit: input.limit ?? 50,
      status: input.status,
      begin_date,
      end_date,
    });

    const rawTxs = result.transactions ?? [];

    // Enriquece pelo banco: cod_external = Transaction.id (pix-plan) ou domPaymentId (outros).
    // netAmount é gravado na criação (amount × LIQUIDEZ) e nunca muda — snapshot imutável.
    const codExternals = rawTxs.map((t) => String(t.cod_external ?? '')).filter(Boolean);
    const domIds = rawTxs.map((t) => String(t.id ?? '')).filter(Boolean);
    const dbTxs = codExternals.length > 0 || domIds.length > 0
      ? await this.prisma.transaction.findMany({
          where: { OR: [{ id: { in: codExternals } }, { domPaymentId: { in: domIds } }] },
          select: { id: true, domPaymentId: true, description: true, netAmount: true },
        })
      : [];
    const dbByCodExternal = new Map(dbTxs.map((t) => [t.id, t]));
    const dbByDomId = new Map(dbTxs.map((t) => [t.domPaymentId ?? '', t]));

    const transactions = rawTxs.map((tx) => {
      const amount = Number(tx.amount ?? 0);
      const dbRecord = dbByCodExternal.get(String(tx.cod_external ?? '')) ?? dbByDomId.get(String(tx.id ?? ''));

      /** Plataforma: prioridade → [TENANT:TAG] no produto → DB description → keywords → GLOBAL. */
      let tenantTag = platformTaxaTagFromText(tx.product_first ?? undefined);
      if (tenantTag === 'GLOBAL' && dbRecord?.description) {
        tenantTag = platformTaxaTagFromText(dbRecord.description);
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

        // netAmount gravado no banco = amount × LIQUIDEZ_na_criação (imutável).
        // Usar esse valor congela a taxa_vendedor da transação — mudar LIQUIDEZ hoje
        // não altera transações passadas. Sem DB record: calcula com taxa atual.
        const storedNet = dbRecord?.netAmount != null ? Number(dbRecord.netAmount) : null;
        if (storedNet !== null) {
          taxaVendedor = Number(Math.max(0, amount - storedNet).toFixed(2));
        } else {
          taxaVendedor = Number(Math.max(0, amount * (1 - L)).toFixed(2));
        }

        const platformFee = taxaVendedor + fixedFees;
        totalFee = Number((mdr2 + platformFee).toFixed(2));
        liquidAmount = Number((amount - totalFee).toFixed(2));
      } else {
        const mdr2 = Number(mdr.toFixed(2));
        taxaDom2 = mdr2;
        const baseFeeFromPayload =
          tx.fee_total != null
            ? Number(tx.fee_total)
            : Number.isFinite(Number(tx.liquid_amount))
              ? Math.max(0, amount - Number(tx.liquid_amount))
              : 0;

        const platformFeeAlreadyInPayload = Math.max(0, baseFeeFromPayload - mdr2);
        const platformFee = Math.max(platformFeeAlreadyInPayload, fixedFees);
        totalFee = Number((mdr2 + platformFee).toFixed(2));
        liquidAmount = Number((amount - totalFee).toFixed(2));
        taxaVendedor = Number(Math.max(0, platformFee - fixedFees).toFixed(2));
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
      ...result,
      transactions,
    };
  }
}
