import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { ORIGEM_MAQUINETA_TAG } from '../../../application/utils/internal-tags.util';

export type MachinesQuery = {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
};

/** Serial do terminal na descrição da transação; preserva hífens. */
export function machineTerminal(description: string | null | undefined) {
  const match = description?.match(/Terminal:\s*([^\s[]+)/i);
  return match ? match[1] : null;
}

const cents = (value: Prisma.Decimal | number | string | null | undefined) =>
  new Prisma.Decimal(value ?? 0).mul(100).toDecimalPlaces(0).toNumber();

function parseDay(value: string | undefined, name: string) {
  if (!value) return undefined;
  const parsed = dayjs(value);
  if (!parsed.isValid()) throw new BadRequestException(`${name} inválida`);
  return parsed;
}

/**
 * Read-only machine (maquineta) sales of the authenticated platform's current
 * owner. Never accepts tenant/document parameters.
 */
export async function platformMachines(
  prisma: any,
  platformId: string,
  query: MachinesQuery = {},
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new BadRequestException('Paginação inválida');
  }
  const start = parseDay(query.startDate, 'startDate');
  const end = parseDay(query.endDate, 'endDate');
  const empty = {
    transactions: [],
    meta: { page, limit, total: 0, totalPages: 0 },
  };

  const platform = await prisma.platform.findUnique({
    where: { id: platformId },
    select: {
      ownerUserId: true,
      isActive: true,
      owner: { select: { isActive: true, isPurged: true } },
    },
  });
  if (
    !platform?.isActive ||
    !platform.owner?.isActive ||
    platform.owner.isPurged
  )
    return empty;

  const where: Prisma.TransactionWhereInput = {
    userId: platform.ownerUserId,
    OR: [
      { description: { contains: ORIGEM_MAQUINETA_TAG, mode: 'insensitive' } },
      { description: { contains: 'Terminal:', mode: 'insensitive' } },
      { description: { contains: 'Maquineta', mode: 'insensitive' } },
    ],
    ...(start || end
      ? {
          createdAt: {
            ...(start ? { gte: start.startOf('day').toDate() } : {}),
            ...(end ? { lte: end.endOf('day').toDate() } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    transactions: rows.map((tx: any) => ({
      id: tx.domPaymentId || tx.id,
      externalId: tx.domTransactionId ?? null,
      terminal: machineTerminal(tx.description),
      amountCents: cents(tx.amount),
      netAmountCents: cents(tx.netAmount),
      status: String(tx.status).toLowerCase(),
      paymentMethod: String(tx.paymentMethod).toLowerCase(),
      installments: tx.installments ?? null,
      cardBrand: tx.cardBrand ?? null,
      cardBin: tx.cardBin ?? null,
      customerName: tx.customerName ?? null,
      customerDocument: tx.customerDocument ?? null,
      customerEmail: tx.customerEmail ?? null,
      customerPhone: tx.customerPhone ?? null,
      description: tx.description ?? null,
      createdAt: tx.createdAt.toISOString(),
      updatedAt: tx.updatedAt.toISOString(),
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
