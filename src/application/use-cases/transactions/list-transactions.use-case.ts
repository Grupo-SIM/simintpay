import { Inject, Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { PAYMENT_GATEWAY, type IPaymentGateway, type DomTaxesOutput } from '../../../core/services/payment-gateway.interface';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';

function mapInternalStatusToPt(
  status: TransactionStatus,
): 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA' {
  switch (status) {
    case TransactionStatus.COMPLETED:
      return 'APROVADA';
    case TransactionStatus.PENDING:
    case TransactionStatus.DRAFT:
      return 'PENDENTE';
    case TransactionStatus.FAILED:
    case TransactionStatus.EXPIRED:
      return 'RECUSADA';
    case TransactionStatus.REFUNDED:
    case TransactionStatus.CHARGEBACK:
      return 'ESTORNADA';
    default:
      return 'PENDENTE';
  }
}

function mapDomStatusToTransactionStatus(status: string): TransactionStatus {
  const s = status.toLowerCase();
  if (s === 'paid' || s === 'approved' || s === 'completed') return TransactionStatus.COMPLETED;
  if (s === 'refunded' || s === 'chargeback') return TransactionStatus.REFUNDED;
  if (s === 'failed' || s === 'rejected' || s === 'expired') return TransactionStatus.FAILED;
  return TransactionStatus.PENDING;
}

function mapPtStatusToInternal(
  status: ListTransactionsQueryDto['status'],
): TransactionStatus[] | undefined {
  switch (status) {
    case 'APROVADA':
      return [TransactionStatus.COMPLETED];
    case 'PENDENTE':
      return [TransactionStatus.PENDING, TransactionStatus.DRAFT];
    case 'RECUSADA':
      return [TransactionStatus.FAILED, TransactionStatus.EXPIRED];
    case 'ESTORNADA':
      return [TransactionStatus.REFUNDED, TransactionStatus.CHARGEBACK];
    default:
      return undefined;
  }
}

@Injectable()
export class ListTransactionsUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: {
    userId: string;
    query: ListTransactionsQueryDto;
  }): Promise<{
    data: Array<{
      id: string;
      valor: number;
      valorLiquido: number | null;
      status: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';
      metodo: 'PIX' | 'CREDIT_CARD';
      descricao: string | null;
      parcelas: number;
      cliente: {
        nome: string | null;
        email: string | null;
        documento: string | null;
      };
      taxas: {
        total: number;
        dom: number;
        plataforma: number;
      };
      criadoEm: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    // 1. Sincronizar com a DOM
    const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (user?.domToken) {
      try {
        const domRes = await this.gateway.listDomTransactions(user.domToken, { page: 1, limit: 100 });

        // Fetch Dom tax rates once so we can calculate domFee per transaction
        // (the list endpoint does not return mdr_value)
        let domTaxes: DomTaxesOutput | null = null;
        const masterKey = process.env.API_DOM_MASTER_KEY;
        if (masterKey) {
          try {
            domTaxes = await this.gateway.getTaxes(masterKey);
            console.log('[Sync] Taxes PIX:', domTaxes?.pix, '| Card parcelas:', domTaxes?.cartaoCredito?.tabelaParcelas?.length);
          } catch (err: any) {
            console.error('[Sync] Failed to fetch taxes:', err.message);
          }
        }

        for (const item of domRes.transactions) {
           // DOM retorna amount e liquid_amount em centavos — converter para reais
           const amount = new Prisma.Decimal(item.amount / 100);
           const liquidRaw = item.liquid_amount ?? 0;
           const netAmount = new Prisma.Decimal(liquidRaw > 0 ? liquidRaw / 100 : 0);
           const totalFee = amount.sub(netAmount);

           // Prefer mdr_value from API; fall back to taxes-based calculation
           let calcDomFee: Prisma.Decimal | undefined =
             item.mdr_value != null ? new Prisma.Decimal(item.mdr_value) : undefined;

           if (!calcDomFee && domTaxes) {
             const isCard = item.payment_method?.toUpperCase().includes('CARD');
             const amt = item.amount / 100; // em reais
             if (!isCard && domTaxes.pix) {
               const pct = domTaxes.pix.percentual ?? 0;
               const fixed = domTaxes.pix.fixo ?? 0;
               calcDomFee = new Prisma.Decimal(amt * (pct / 100) + fixed);
             } else if (isCard && domTaxes.cartaoCredito?.tabelaParcelas) {
               const installments = item.installments ?? 1;
               const row = domTaxes.cartaoCredito.tabelaParcelas.find(r => Number(r.parcelas) === installments);
               if (row) calcDomFee = new Prisma.Decimal(amt * (parseFloat(row.taxaDom) / 100));
             }
           }

           const calcPlatformFee = calcDomFee
             ? Prisma.Decimal.max(new Prisma.Decimal(0), totalFee.sub(calcDomFee))
             : undefined;

           const parsedDate = item.created_at
             ? new Date(item.created_at.replace(' ', 'T'))
             : new Date();
           const createdAt = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

           // order_id é o identificador aceito pelo endpoint /front-store/transaction/{id} do DOM
           const domPaymentId = item.order_id || item.cod_external || item.id;

           // Upsert na tabela local
           await this.prisma.transaction.upsert({
             where: { domPaymentId },
             update: {
               status: mapDomStatusToTransactionStatus(item.status),
               amount,
               netAmount,
               totalFee,
               ...(calcDomFee !== undefined && { domFee: calcDomFee }),
               ...(calcPlatformFee !== undefined && { platformFee: calcPlatformFee }),
               customerName: item.customer_name,
               customerEmail: item.customer_email,
               customerDocument: item.customer_document,
               customerPhone: item.customer_phone,
               updatedAt: new Date(),
             },
             create: {
               userId: user.id,
               amount,
               netAmount,
               totalFee,
               ...(calcDomFee !== undefined && { domFee: calcDomFee }),
               ...(calcPlatformFee !== undefined && { platformFee: calcPlatformFee }),
               status: mapDomStatusToTransactionStatus(item.status),
               paymentMethod: item.payment_method?.toUpperCase().includes('CARD') ? PaymentMethod.CREDIT_CARD : PaymentMethod.PIX,
               domTransactionId: item.id,
               domPaymentId,
               customerName: item.customer_name,
               customerEmail: item.customer_email,
               customerDocument: item.customer_document,
               customerPhone: item.customer_phone,
               description: item.product_first,
               createdAt,
             }
           }).catch(err => console.error(`Erro ao sincronizar transação ${item.id}:`, err.message));
        }
      } catch (err: any) {
        console.error('[Sync Error]', err.message);
      }
    }
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;

    const and: Prisma.TransactionWhereInput[] = [{ userId: input.userId }];

    const statuses = mapPtStatusToInternal(input.query.status);
    if (statuses) {
      and.push({ status: { in: statuses } });
    }

    if (input.query.metodo) {
      and.push({
        paymentMethod:
          input.query.metodo === 'PIX'
            ? PaymentMethod.PIX
            : PaymentMethod.CREDIT_CARD,
      });
    }

    const q = input.query.q?.trim();
    if (q && q.length > 0) {
      and.push({
        OR: [
          { id: { contains: q, mode: 'insensitive' } },
          { domTransactionId: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { customerEmail: { contains: q, mode: 'insensitive' } },
          { customerName: { contains: q, mode: 'insensitive' } },
          { customerDocument: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (input.query.id) {
      and.push({
        OR: [
          { id: { contains: input.query.id, mode: 'insensitive' } },
          { domTransactionId: { contains: input.query.id, mode: 'insensitive' } },
        ],
      });
    }

    if (input.query.customerName) {
      and.push({ customerName: { contains: input.query.customerName, mode: 'insensitive' } });
    }

    if (input.query.customerEmail) {
      and.push({ customerEmail: { contains: input.query.customerEmail, mode: 'insensitive' } });
    }

    if (input.query.customerDocument) {
      and.push({ customerDocument: { contains: input.query.customerDocument, mode: 'insensitive' } });
    }

    if (input.query.domTransactionId) {
      and.push({ domTransactionId: { contains: input.query.domTransactionId, mode: 'insensitive' } });
    }

    if (input.query.dataInicio || input.query.dataFim) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (input.query.dataInicio) {
        const d = new Date(input.query.dataInicio);
        if (!Number.isNaN(d.getTime())) {
          // Garante início do dia em UTC ou conforme a string
          d.setUTCHours(0, 0, 0, 0);
          createdAt.gte = d;
        }
      }
      if (input.query.dataFim) {
        const d = new Date(input.query.dataFim);
        if (!Number.isNaN(d.getTime())) {
          // Garante fim do dia (23:59:59.999)
          d.setUTCHours(23, 59, 59, 999);
          createdAt.lte = d;
        }
      }
      and.push({ createdAt });
    }

    const where: Prisma.TransactionWhereInput = { AND: and };

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: items.map((t) => ({
        id: t.id,
        valor: Number(t.amount),
        valorLiquido: t.netAmount != null ? Number(t.netAmount) : null,
        status: mapInternalStatusToPt(t.status),
        metodo: t.paymentMethod,
        descricao: t.description ?? null,
        parcelas: t.installments,
        cliente: {
          nome: t.customerName ?? null,
          email: t.customerEmail ?? null,
          documento: t.customerDocument ?? null,
        },
        taxas: {
          total: Number(t.totalFee),
          dom: Number(t.domFee),
          plataforma: Number(t.platformFee),
        },
        criadoEm: t.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }
}
