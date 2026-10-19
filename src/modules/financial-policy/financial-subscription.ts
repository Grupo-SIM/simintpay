import { Prisma, TransactionStatus } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { persistLinkCharge } from '../platform-core/link-settlement';
import { cents } from './financial-policy';
import { restoreFinancialCharge } from './financial-charge';

export async function settleFinancialSubscription(prisma: PrismaService, input: { snapshot: Prisma.JsonValue | null | undefined; amount: Prisma.Decimal; paymentId: string; userId: string; method: 'PIX' | 'CREDIT_CARD'; name: string; customerName?: string | null; customerEmail?: string | null; customerDocument?: string | null }) {
  const quote = await restoreFinancialCharge(prisma, input.snapshot);
  if (!quote) return null;
  if (cents(input.amount) !== cents(quote.totalAmount)) throw new Error('Cobrança recorrente diverge do contrato financeiro');
  await prisma.$transaction(async tx => {
    await tx.wallet.upsert({ where: { userId: input.userId }, update: {}, create: { userId: input.userId, balance: 0 } });
    await persistLinkCharge(tx, { userId: input.userId, amount: new Prisma.Decimal(quote.totalAmount), netAmount: new Prisma.Decimal(quote.netAmount),
      domPaymentId: input.paymentId, paymentMethod: input.method, financialSnapshot: quote.financialSnapshot,
      totalFee: new Prisma.Decimal(quote.totalFeeAmount), domFee: new Prisma.Decimal(quote.domFeeAmount), platformFee: new Prisma.Decimal(quote.platformProfit),
      description: `${input.name} [TENANT:${quote.financialSnapshot.policyTag}]`, customerName: input.customerName, customerEmail: input.customerEmail, customerDocument: input.customerDocument,
    }, TransactionStatus.COMPLETED);
  });
  return quote;
}
