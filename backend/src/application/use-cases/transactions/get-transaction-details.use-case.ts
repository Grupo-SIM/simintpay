import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { stripInternalTags } from '../../utils/internal-tags.util';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import {
  estimateDomFeeReais,
  platformTaxaTagFromText,
} from '../../helpers/dom-fee-estimate.helper';
import { isPixLikePayment } from '../../helpers/platform-fee-split.helper';
import { PaymentGatewayResolver } from '../../../infrastructure/http/payment-gateway.resolver';
import { toAcquirer } from '../../../core/services/acquirer.enum';
import { transactionCoproductionInfo } from '../../../modules/coproduction/coproduction-view';

@Injectable()
export class GetTransactionDetailsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayResolver: PaymentGatewayResolver,
  ) {}

  private mapStatusToLabel(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.COMPLETED:
        return 'Aprovado';
      case TransactionStatus.REFUNDED:
        return 'Estornado';
      case TransactionStatus.CHARGEBACK:
        return 'Chargeback';
      case TransactionStatus.FAILED:
        return 'Recusado';
      case TransactionStatus.EXPIRED:
        return 'Expirado';
      case TransactionStatus.IN_MEDIATION:
        return 'Em mediação';
      case TransactionStatus.PENDING_REFUND:
        return 'Estorno pendente';
      case TransactionStatus.PENDING:
        return 'Pendente';
      default:
        return 'Rascunho';
    }
  }

  private mapStatusToType(status: TransactionStatus): string {
    switch (status) {
      case TransactionStatus.COMPLETED:
        return 'approved';
      case TransactionStatus.REFUNDED:
        return 'refunded';
      case TransactionStatus.CHARGEBACK:
        return 'chargeback';
      case TransactionStatus.FAILED:
        return 'failed';
      case TransactionStatus.EXPIRED:
        return 'expired';
      case TransactionStatus.PENDING:
        return 'pending';
      default:
        return 'draft';
    }
  }

  /** Format a UTC Date as BRT (UTC-3) string "YYYY-MM-DD HH:MM:SS" */
  private toBRT(date: Date): string {
    const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
    return brt.toISOString().replace('T', ' ').slice(0, 19);
  }

  private fixedFees(): {
    transactionFixedFee: number;
    cashbackFee: number;
    total: number;
  } {
    const fixedTx = getPlatformTaxaEffective(
      'GLOBAL',
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const fixedCashback = getPlatformTaxaEffective(
      'GLOBAL',
      'TAXA_CASHBACK',
      PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK,
    );
    return {
      transactionFixedFee: fixedTx,
      cashbackFee: fixedCashback,
      total: fixedTx + fixedCashback,
    };
  }

  private applyFixedFeesToOrder(order: any): any {
    const total = Number(order?.total ?? 0);
    let mdr = Number(order?.mdr_value ?? 0);
    const installmentFee = Number(order?.fee_installment_value ?? 0);
    const itemsFirstName =
      Array.isArray(order?.items) && order.items.length > 0
        ? String(order.items[0]?.name ?? '')
        : '';
    const tenantTag = platformTaxaTagFromText(itemsFirstName);
    if (mdr <= 0 && installmentFee <= 0) {
      mdr = estimateDomFeeReais({
        amountReais: total,
        paymentMethod: String(order?.type_payment ?? ''),
        installments: Number(order?.installments ?? order?.parcelas ?? 1) || 1,
        tenantTag,
      });
    }
    const {
      transactionFixedFee,
      cashbackFee,
      total: minPlatformFee,
    } = this.fixedFees();
    const L = getPlatformTaxaEffective(
      tenantTag,
      'LIQUIDEZ',
      PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
    );
    const typePay = String(order?.type_payment ?? '');
    const pix = isPixLikePayment(typePay);
    const domInstallSum = mdr + installmentFee;
    const dom2 = Number(domInstallSum.toFixed(2));

    let totalFee: number;
    let totalLiquid: number;
    let taxaVendedor: number;

    if (pix) {
      const taxaPlataformaPct = Math.max(0, total * (1 - L));
      const platformFee = taxaPlataformaPct + minPlatformFee;
      totalFee = Number((dom2 + platformFee).toFixed(2));
      totalLiquid = Number((total - totalFee).toFixed(2));
      taxaVendedor = Number(
        Math.max(0, taxaPlataformaPct + installmentFee).toFixed(2),
      );
    } else {
      const existingTotalFee = Number(order?.fee_total_value ?? 0);
      const currentPlatformFee = Math.max(
        0,
        existingTotalFee - mdr - installmentFee,
      );
      const platformFee = Math.max(currentPlatformFee, minPlatformFee);
      totalFee = Number((mdr + installmentFee + platformFee).toFixed(2));
      totalLiquid = Number((total - totalFee).toFixed(2));
      taxaVendedor = Number(
        Math.max(0, installmentFee + platformFee - minPlatformFee).toFixed(2),
      );
    }

    const taxaDomTotal = dom2;
    /** P&L do master: Taxa Vendedor − (DOM + taxa fixa + cashback). */
    const lucroMaster = Number(
      (taxaVendedor - taxaDomTotal - transactionFixedFee - cashbackFee).toFixed(
        2,
      ),
    );

    return {
      ...order,
      fee_total_value: totalFee,
      total_liquid: totalLiquid,
      valor_bruto_venda: Number(total.toFixed(2)),
      taxa_dom: taxaDomTotal,
      taxa_vendedor: taxaVendedor,
      taxa_fixa_transacao: Number(transactionFixedFee.toFixed(2)),
      taxa_cashback: Number(cashbackFee.toFixed(2)),
      valor_liquido_vendedor: totalLiquid,
      lucro_master: lucroMaster,
    };
  }

  private buildFallbackOrder(tx: any): object {
    const amount = Number(tx.amount ?? 0);
    const netAmount = Number(tx.netAmount ?? 0);
    // Prefer stored totalFee; calculate from amount-netAmount as fallback
    const totalFee =
      Number(tx.totalFee ?? 0) || Math.max(0, amount - netAmount);
    const domFee = Number(tx.domFee ?? 0);

    const historicStatus = tx.statusHistory?.length
      ? tx.statusHistory.map((h: any) => ({
          status: this.mapStatusToLabel(h.toStatus),
          type: this.mapStatusToType(h.toStatus),
          date: this.toBRT(h.createdAt),
          color:
            h.toStatus === TransactionStatus.COMPLETED ? '#40a083' : '#3fa0e5',
        }))
      : [
          {
            status: 'Pendente',
            type: 'pending',
            date: this.toBRT(tx.createdAt),
            color: '#3fa0e5',
          },
          ...(tx.status === TransactionStatus.COMPLETED
            ? [
                {
                  status: 'Aprovado',
                  type: 'approved',
                  date: this.toBRT(tx.updatedAt),
                  color: '#40a083',
                },
              ]
            : []),
        ];

    return this.applyFixedFeesToOrder({
      order_id: tx.domPaymentId ?? tx.id,
      id_transaction: tx.domTransactionId ?? tx.id,
      type: this.mapStatusToType(tx.status),
      type_payment:
        tx.paymentMethod === 'CREDIT_CARD' ? 'Cartão de Crédito' : 'PIX',
      date_register: this.toBRT(tx.createdAt),
      origin: 'SimPay',
      total: amount,
      total_liquid: netAmount,
      fee_total_value: totalFee,
      mdr_value: domFee,
      fee_installment_value: 0,
      client_name: tx.customerName ?? '',
      client_document: tx.customerDocument ?? '',
      client_phone: tx.customerPhone ?? '',
      client_email: tx.customerEmail ?? '',
      paid_date:
        tx.status === TransactionStatus.COMPLETED
          ? this.toBRT(tx.updatedAt)
          : null,
      msg_3ds: null,
      pix_content: tx.pixContent ?? null,
      items: [
        {
          name: stripInternalTags(tx.description) ?? 'Produto',
          quant: 1,
          price: amount,
        },
      ],
      historic_status: historicStatus,
    });
  }

  /** Coprodutores veem a transação completa, somente leitura; `coproducao` identifica o papel. */
  async execute(input: { userId: string; role: string; id: string }) {
    const loaded = await this.load(input);
    const detail =
      input.role === 'ADMIN'
        ? loaded
        : { ...loaded, order: this.toCustomerOrder((loaded as any).order) };
    const tx = await this.prisma.transaction.findUnique({
      where: { id: input.id },
      select: { id: true, userId: true, financialSnapshot: true },
    });
    const coproducao = tx
      ? ((
          await transactionCoproductionInfo(this.prisma, input.userId, [tx])
        ).get(tx.id) ?? null)
      : null;
    return { ...detail, coproducao };
  }

  /**
   * Clientes só enxergam o universo SimIntPay: campos próprios da adquirente
   * (taxa/MDR, 3DS, lucro master) e qualquer campo cru do gateway ficam de fora.
   */
  private toCustomerOrder(order: any): any {
    if (!order) return order;
    const allowed = [
      'client_document',
      'client_email',
      'client_name',
      'client_phone',
      'date_register',
      'fee_total_value',
      'historic_status',
      'id_transaction',
      'items',
      'origin',
      'paid_date',
      'pix_content',
      'taxa_cashback',
      'taxa_fixa_transacao',
      'taxa_vendedor',
      'total',
      'total_liquid',
      'type',
      'type_payment',
      'valor_bruto_venda',
      'valor_liquido_vendedor',
    ];
    return Object.fromEntries(
      allowed.filter((k) => k in order).map((k) => [k, order[k]]),
    );
  }

  private async load(input: { userId: string; role: string; id: string }) {
    // 1. Find local transaction
    const tx = await this.prisma.transaction.findFirst({
      where: {
        id: input.id,
        ...(input.role === 'ADMIN'
          ? {}
          : {
              OR: [
                { userId: input.userId },
                { coproductionAllocations: { some: { userId: input.userId } } },
              ],
            }),
      },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        user: { select: { domToken: true, role: true } },
      },
    });

    if (!tx) {
      throw new NotFoundException(`Transação ${input.id} não encontrada.`);
    }

    // 2. Try Dom API using all available IDs
    const domToken = tx.user?.domToken;
    const domIdsToTry = [tx.domPaymentId, tx.domTransactionId].filter(
      Boolean,
    ) as string[];

    if (domToken && domIdsToTry.length > 0) {
      const gateway = this.gatewayResolver.byAcquirer(toAcquirer(tx.acquirer));
      for (const domId of domIdsToTry) {
        try {
          const detail = await gateway.getDomTransactionDetail(domToken, domId);
          // DOM /front-store/transaction retorna { order: {...}, reasons: [...] } sem status: 'OK'
          if (detail?.order) {
            // Cache mdr_value in domFee column for future fallbacks
            const mdrVal = Number(detail.order.mdr_value ?? 0);
            if (mdrVal > 0) {
              this.prisma.transaction
                .update({
                  where: { id: tx.id },
                  data: { domFee: new Prisma.Decimal(mdrVal) },
                })
                .catch(() => {});
            }
            // API real não retorna status_history — injetar do banco local
            if (!detail.order.historic_status?.length) {
              detail.order.historic_status = tx.statusHistory?.length
                ? tx.statusHistory.map((h: any) => ({
                    status: this.mapStatusToLabel(h.toStatus),
                    type: this.mapStatusToType(h.toStatus),
                    date: this.toBRT(h.createdAt),
                    color:
                      h.toStatus === TransactionStatus.COMPLETED
                        ? '#40a083'
                        : '#3fa0e5',
                  }))
                : [
                    {
                      status: 'Pendente',
                      type: 'pending',
                      date: this.toBRT(tx.createdAt),
                      color: '#3fa0e5',
                    },
                    ...(tx.status === TransactionStatus.COMPLETED
                      ? [
                          {
                            status: 'Aprovado',
                            type: 'approved',
                            date: this.toBRT(tx.updatedAt),
                            color: '#40a083',
                          },
                        ]
                      : []),
                  ];
            }
            detail.order = this.applyFixedFeesToOrder(detail.order);
            return detail;
          }
        } catch {
          // try next id
        }
      }
    }
    // 3. Fallback: build from local DB
    return { status: 'OK', order: this.buildFallbackOrder(tx) };
  }
}
