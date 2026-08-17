import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';

dayjs.extend(utc);
dayjs.extend(timezone);

const BRT = 'America/Sao_Paulo';
const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

@Injectable()
export class ListTransactionsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Ledger local only. Cron and webhooks synchronize acquirers separately. */
  async execute(input: { userId: string; role: string; query: ListTransactionsQueryDto }) {
    const page = input.query.page ?? 1;
    const limit = input.query.limit ?? 20;
    const and: Prisma.TransactionWhereInput[] = [];

    if (input.role !== 'ADMIN') {
      const user = await this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { cpf: true },
      });
      if (!user) throw new Error('Usuário não encontrado');

      const cpfDigits = user.cpf?.replace(/\D/g, '');
      if (cpfDigits) {
        const cpfFormatted = cpfDigits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        and.push({
          OR: [
            { userId: input.userId },
            {
              AND: [
                { userId: RENOVADA_ID },
                {
                  OR: [
                    { description: { contains: cpfDigits, mode: Prisma.QueryMode.insensitive } },
                    { description: { contains: cpfFormatted, mode: Prisma.QueryMode.insensitive } },
                  ],
                },
              ],
            },
          ],
        });
      } else {
        and.push({ userId: input.userId });
      }
    }

    if (input.query.status) and.push({ status: input.query.status });
    if (input.query.payment_method) and.push({ paymentMethod: input.query.payment_method });
    if (input.query.acquirer) and.push({ acquirer: input.query.acquirer });

    const q = input.query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { id: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { domTransactionId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { domPaymentId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { externalTransactionId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { externalPaymentId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
        ],
      });
    }

    if (input.query.begin_date || input.query.end_date) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (input.query.begin_date) {
        const start = dayjs.tz(input.query.begin_date, BRT).startOf('day');
        if (start.isValid()) createdAt.gte = start.toDate();
      }
      if (input.query.end_date) {
        const end = dayjs.tz(input.query.end_date, BRT).endOf('day');
        if (end.isValid()) createdAt.lte = end.toDate();
      }
      and.push({ createdAt });
    }

    const where: Prisma.TransactionWhereInput = and.length ? { AND: and } : {};
    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);

    return {
      data: {
        transactions: transactions.map((transaction) => ({
          id: transaction.id,
          userId: transaction.userId,
          amount: transaction.amount.toString(),
          netAmount: transaction.netAmount?.toString() ?? null,
          status: transaction.status,
          previousStatus: transaction.previousStatus,
          paymentMethod: transaction.paymentMethod,
          description: transaction.description,
          installments: transaction.installments,
          totalFee: transaction.totalFee.toString(),
          domFee: transaction.domFee.toString(),
          platformFee: transaction.platformFee.toString(),
          domTransactionId: transaction.domTransactionId,
          domPaymentId: transaction.domPaymentId,
          acquirer: transaction.acquirer,
          externalTransactionId: transaction.externalTransactionId,
          externalPaymentId: transaction.externalPaymentId,
          pixQrCode: transaction.pixQrCode,
          pixContent: transaction.pixContent,
          pixExpire: transaction.pixExpire?.toISOString() ?? null,
          cardBrand: transaction.cardBrand,
          cardBin: transaction.cardBin,
          cardCodeAuth: transaction.cardCodeAuth,
          customerName: transaction.customerName,
          customerEmail: transaction.customerEmail,
          customerDocument: transaction.customerDocument,
          customerPhone: transaction.customerPhone,
          paymentLinkId: transaction.paymentLinkId,
          createdAt: transaction.createdAt.toISOString(),
          updatedAt: transaction.updatedAt.toISOString(),
        })),
        total,
      },
      page,
      limit,
    };
  }
}
