import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { settleEbookPayment } from './ebook-settlement';

/** Read-only provider lookup first. Never reissues payment creation. Missing/normalized-away evidence fails closed. */
export async function recoverEbookPayment(
  prisma: PrismaService,
  gateway: IPaymentGateway,
  token: string,
  settlementId: string,
  paymentId: string,
) {
  const rows = await prisma.$queryRaw<
    {
      transactionId: string;
      manifest: { grossCents: number };
      state: string;
      providerPaymentId: string | null;
      providerCredentialHash: string | null;
    }[]
  >`SELECT "transactionId",manifest,state,"providerPaymentId","providerCredentialHash" FROM "EbookSettlement" WHERE id = ${settlementId}`;
  const enrollment = rows[0];
  if (
    !enrollment?.transactionId ||
    !['CREATING', 'PENDING', 'SETTLED', 'LOCKED', 'REVERSED'].includes(
      enrollment.state,
    )
  )
    throw new ConflictException('EBOOK_RECOVERY_NOT_APPLICABLE');
  if (
    !token ||
    enrollment.providerCredentialHash !==
      createHash('sha256').update(token).digest('hex')
  )
    throw new ConflictException('EBOOK_PROVIDER_ACCOUNT_CREDENTIAL_CHANGED');
  const transaction = await prisma.transaction.findUniqueOrThrow({
    where: { id: enrollment.transactionId },
  });
  if (transaction.acquirer !== 'DOM' || transaction.platformTag !== 'EBOOK')
    throw new ConflictException('EBOOK_RECOVERY_DOM_ONLY');
  const detail = await gateway.getDomTransactionDetail(token, paymentId);
  const expectedMethod =
    transaction.paymentMethod === 'PIX'
      ? 'pix'
      : transaction.paymentMethod === 'CREDIT_CARD'
        ? 'credit_card'
        : null;
  // Existing DOM client returns a normalized order. No fallbacks to description, email, or caller amounts.
  if (
    !detail ||
    detail.id_transaction !== paymentId ||
    detail.order_id !== transaction.id ||
    !expectedMethod ||
    detail.type_payment !== expectedMethod ||
    typeof detail.total !== 'number' ||
    !Number.isFinite(detail.total) ||
    Math.round(detail.total * 100) !== enrollment.manifest.grossCents
  )
    throw new ConflictException('EBOOK_PROVIDER_RECOVERY_PROOF_MISMATCH');
  await prisma.$transaction(async (p) => {
    const locked = await p.$queryRaw<
      { state: string; providerPaymentId: string | null }[]
    >`SELECT state,"providerPaymentId" FROM "EbookSettlement" WHERE id = ${settlementId} FOR UPDATE`;
    if (
      !locked[0] ||
      (locked[0].providerPaymentId &&
        locked[0].providerPaymentId !== paymentId) ||
      (!locked[0].providerPaymentId && locked[0].state !== 'CREATING')
    )
      throw new ConflictException('EBOOK_RECOVERY_BINDING_CONFLICT');
    if (locked[0].providerPaymentId === paymentId) return;
    await p.$executeRaw`UPDATE "EbookSettlement" SET "providerPaymentId" = ${paymentId}, state = 'PENDING', "reasonCode" = 'DOM_VERIFIED_OPERATOR_RECOVERY', "updatedAt" = now() WHERE id = ${settlementId}`;
    await p.transaction.update({
      where: { id: transaction.id },
      data: { domPaymentId: paymentId, externalPaymentId: paymentId },
    });
    await p.transactionStatusHistory.create({
      data: {
        transactionId: transaction.id,
        fromStatus: transaction.status,
        toStatus: transaction.status,
        metadata: {
          source: 'EBOOK_VERIFIED_RECOVERY',
          paymentId,
          proof: 'credential-scoped exact reference/gross/method',
        },
      },
    });
  });
  await settleEbookPayment(
    prisma,
    paymentId,
    String(detail.type ?? 'pending'),
    transaction.id,
  );
  return { settlementId, paymentId, recovered: true };
}
