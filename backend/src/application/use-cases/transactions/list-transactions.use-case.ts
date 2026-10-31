import { getPlatformOwnerId } from '../../../modules/module.registry';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { transactionCoproductionInfo } from '../../../modules/coproduction/coproduction-view';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';

dayjs.extend(utc);
dayjs.extend(timezone);

const BRT = 'America/Sao_Paulo';

@Injectable()
export class ListTransactionsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  /** Ledger local only. Cron and webhooks synchronize acquirers separately. */
  async execute(input: {
    userId: string;
    role: string;
    query: ListTransactionsQueryDto;
  }) {
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
        const cpfFormatted = cpfDigits.replace(
          /(\d{3})(\d{3})(\d{3})(\d{2})/,
          '$1.$2.$3-$4',
        );
        and.push({
          OR: [
            { userId: input.userId },
            { coproductionAllocations: { some: { userId: input.userId } } },
            {
              AND: [
                { userId: getPlatformOwnerId('RENOVADA') ?? '' },
                {
                  OR: [
                    {
                      description: {
                        contains: cpfDigits,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                    {
                      description: {
                        contains: cpfFormatted,
                        mode: Prisma.QueryMode.insensitive,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        });
      } else {
        and.push({
          OR: [
            { userId: input.userId },
            { coproductionAllocations: { some: { userId: input.userId } } },
          ],
        });
      }
    }

    if (input.query.status) and.push({ status: input.query.status });
    if (input.query.payment_method)
      and.push({ paymentMethod: input.query.payment_method });
    if (input.query.acquirer) and.push({ acquirer: input.query.acquirer });

    const q = input.query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { id: { contains: q, mode: Prisma.QueryMode.insensitive } },
          {
            domTransactionId: {
              contains: q,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          { domPaymentId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          {
            externalTransactionId: {
              contains: q,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            externalPaymentId: {
              contains: q,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
          { customerName: { contains: q, mode: Prisma.QueryMode.insensitive } },
          {
            customerEmail: { contains: q, mode: Prisma.QueryMode.insensitive },
          },
          {
            customerDocument: {
              contains: q,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          ...(q.replace(/\D/g, '') && /^[\d\s./-]+$/.test(q)
            ? [{ customerDocument: { contains: q.replace(/\D/g, '') } }]
            : []),
        ],
      });
    }

    for (const field of ['id', 'customerName', 'customerEmail'] as const) {
      const value = input.query[field]?.trim();
      if (value)
        and.push({ [field]: { contains: value, mode: 'insensitive' } });
    }
    const reference = input.query.domTransactionId?.trim();
    if (reference) {
      and.push({
        OR: [
          'domTransactionId',
          'domPaymentId',
          'externalTransactionId',
          'externalPaymentId',
        ].map((field) => ({
          [field]: { contains: reference, mode: 'insensitive' },
        })),
      });
    }
    const document = input.query.customerDocument?.trim();
    if (document) {
      const digits = document.replace(/\D/g, '');
      const formatted =
        digits.length === 11
          ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
          : digits.length === 14
            ? digits.replace(
                /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
                '$1.$2.$3/$4-$5',
              )
            : document;
      and.push({
        OR: [...new Set([document, digits, formatted])]
          .filter(Boolean)
          .map((value) => ({
            customerDocument: { contains: value, mode: 'insensitive' },
          })),
      });
    }
    if (input.query.plataforma?.trim()) {
      and.push({
        platformTag: {
          equals: input.query.plataforma.trim(),
          mode: 'insensitive',
        },
      });
    }

    const machineFilter: Prisma.TransactionWhereInput = {
      OR: [
        { description: { contains: 'maquineta', mode: 'insensitive' } },
        { description: { contains: 'terminal', mode: 'insensitive' } },
      ],
    };
    if (input.query.tipoTransacao === 'maquinetas') and.push(machineFilter);
    if (input.query.tipoTransacao === 'online') {
      and.push({ OR: [{ description: null }, { NOT: machineFilter }] });
    }

    if (input.query.begin_date || input.query.end_date) {
      const createdAt: Prisma.DateTimeFilter = {};
      for (const date of [input.query.begin_date, input.query.end_date]) {
        if (!date) continue;
        const parsed = dayjs.tz(date, BRT);
        if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== date) {
          throw new BadRequestException('Data inválida; use YYYY-MM-DD');
        }
      }
      if (
        input.query.begin_date &&
        input.query.end_date &&
        input.query.begin_date > input.query.end_date
      ) {
        throw new BadRequestException(
          'Data inicial deve ser anterior à data final',
        );
      }
      if (input.query.begin_date) {
        createdAt.gte = dayjs
          .tz(input.query.begin_date, BRT)
          .startOf('day')
          .toDate();
      }
      if (input.query.end_date) {
        createdAt.lte = dayjs
          .tz(input.query.end_date, BRT)
          .endOf('day')
          .toDate();
      }
      and.push({ createdAt });
    }

    const where: Prisma.TransactionWhereInput = and.length ? { AND: and } : {};
    const [total, transactions] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const coproducao = await transactionCoproductionInfo(
      this.prisma,
      input.userId,
      transactions,
    );

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
          platformTag: transaction.platformTag,
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
          coproducao: coproducao.get(transaction.id) ?? null,
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
