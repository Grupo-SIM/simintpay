import { transactionPlatformTagData } from '../platform-core/transaction-platform';
import { snapshotFrom } from '../coproduction/coproduction';
import { Prisma, TransactionStatus } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { persistLinkCharge } from '../platform-core/link-settlement';
import { cents } from './financial-policy';
import { restoreFinancialCharge } from './financial-charge';

type FinancialSubscriptionInput = {
  snapshot: Prisma.JsonValue | null | undefined;
  amount: Prisma.Decimal;
  paymentId: string;
  userId: string;
  method: 'PIX' | 'CREDIT_CARD';
  name: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerDocument?: string | null;
  tracking?: Prisma.JsonValue | null;
  pixContent?: string | null;
  pixExpire?: Date | null;
  createdAt?: Date;
};

/** Pagamento confirmado: cria (ou promove a PENDING existente) e credita a carteira. */
export function settleFinancialSubscription(
  prisma: PrismaService,
  input: FinancialSubscriptionInput,
) {
  return persistFinancialSubscription(
    prisma,
    input,
    TransactionStatus.COMPLETED,
  );
}

/**
 * Pix gerado: grava a Transaction PENDING com o mesmo snapshot que o pagamento usaria, para a
 * venda aparecer na listagem, entrar na reconciliação e ser promovida sem duplicar (upsert pelo
 * domPaymentId em `persistLinkCharge`).
 */
export function openFinancialSubscription(
  prisma: PrismaService,
  input: FinancialSubscriptionInput,
) {
  return persistFinancialSubscription(prisma, input, TransactionStatus.PENDING);
}

/** Pix expirado/falho: encerra a Transaction PENDING correspondente. */
export function closeFinancialSubscription(
  prisma: PrismaService,
  input: FinancialSubscriptionInput,
  status: 'EXPIRED' | 'FAILED',
) {
  return persistFinancialSubscription(prisma, input, TransactionStatus[status]);
}

async function persistFinancialSubscription(
  prisma: PrismaService,
  input: FinancialSubscriptionInput,
  status: TransactionStatus,
) {
  const agreement = snapshotFrom(input.snapshot);
  const legacy =
    agreement &&
    input.snapshot &&
    typeof input.snapshot === 'object' &&
    !Array.isArray(input.snapshot)
      ? (input.snapshot.coproductionLegacy as
          | {
              totalAmount: number;
              netAmount: number;
              totalFeeAmount: number;
              domFeeAmount: number;
              platformProfit: number;
              policyTag: string;
            }
          | undefined)
      : undefined;
  const quote = legacy
    ? {
        ...legacy,
        financialSnapshot: { policyTag: legacy.policyTag },
        platformFeeRate: 0,
      }
    : await restoreFinancialCharge(prisma, input.snapshot);
  if (!quote) return null;
  if (cents(input.amount) !== cents(quote.totalAmount))
    throw new Error('Cobrança recorrente diverge da configuração financeira');
  await prisma.$transaction(async (tx) => {
    await tx.wallet.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId, balance: 0 },
    });
    await persistLinkCharge(
      tx,
      {
        userId: input.userId,
        amount: new Prisma.Decimal(quote.totalAmount),
        netAmount: new Prisma.Decimal(quote.netAmount),
        domPaymentId: input.paymentId,
        paymentMethod: input.method,
        financialSnapshot: input.snapshot as Prisma.InputJsonValue,
        totalFee: new Prisma.Decimal(quote.totalFeeAmount),
        // These legacy columns are non-nullable; unknown realized cost and profit stay
        // explicitly unknown in the immutable financial snapshot, not measured as zero.
        acquirerFee: new Prisma.Decimal(quote.domFeeAmount ?? 0),
        platformFee: new Prisma.Decimal(quote.platformProfit ?? 0),
        ...transactionPlatformTagData(quote.financialSnapshot.policyTag),
        description: `${input.name} [TENANT:${
          quote.financialSnapshot.policyTag.startsWith('USER:')
            ? 'GLOBAL'
            : quote.financialSnapshot.policyTag
        }]`,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerDocument: input.customerDocument,
        tracking: (input.tracking ?? undefined) as
          Prisma.InputJsonValue | undefined,
        ...(input.pixContent ? { pixContent: input.pixContent } : {}),
        ...(input.pixExpire ? { pixExpire: input.pixExpire } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
      status,
    );
  });
  return quote;
}
