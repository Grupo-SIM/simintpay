import { BadRequestException } from '@nestjs/common';

/** Voucher columns the offer rules read (amounts in reais, like the legacy Voucher table). */
export type VoucherRow = {
  id: string;
  code: string;
  isActive: boolean;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  maxUsage: number | null;
  usageCount: number;
  maxDiscountValue: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  minOrderValue: number | null;
  applicablePlans: string[];
  allowedLinkCodes: string[];
  allowedChannels: string[];
};

export type VoucherOfferTarget = {
  id: string;
  code: string;
  platformTag: string | null;
};

export type OfferVoucherQuote = {
  valid: true;
  voucherId: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: number;
  originalAmountCents: number;
  discountAmountCents: number;
  finalAmountCents: number;
};

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Voucher rules for an offer charge, modelled on the legacy subscription-link flow
 * (`VoucherService.validateVoucher`). Pure: the caller loads the voucher of the offer owner.
 *
 * - `applicablePlans` lists offer ids and `allowedLinkCodes` lists offer codes (legacy ids/codes
 *   keep working because the offer reuses the legacy id and code).
 * - `allowedChannels` is only enforced for offers that belong to a platform (`platformTag`).
 * - The discount applies to the amount charged before fees: `amountCents` is the seller price.
 * - Money stays in integer cents: the percentage discount rounds half up, a fixed one comes
 *   from the reais column rounded to cents, both capped at the amount.
 */
export function quoteOfferVoucher(
  voucher: VoucherRow | null,
  offer: VoucherOfferTarget,
  amountCents: number,
  now = new Date(),
): OfferVoucherQuote {
  if (!voucher || !voucher.isActive)
    throw new BadRequestException('Voucher não encontrado ou inválido');
  if (voucher.validFrom && now < voucher.validFrom)
    throw new BadRequestException('Voucher ainda não está válido');
  if (voucher.validUntil && now > voucher.validUntil)
    throw new BadRequestException('Voucher expirado');
  if (voucher.maxUsage != null && voucher.usageCount >= voucher.maxUsage)
    throw new BadRequestException('Voucher atingiu o limite de uso');
  if (
    voucher.minOrderValue != null &&
    amountCents < Math.round(voucher.minOrderValue * 100)
  )
    throw new BadRequestException(
      `Valor mínimo do pedido para este voucher é R$ ${voucher.minOrderValue.toFixed(2)}`,
    );

  const channel = offer.platformTag?.toUpperCase();
  if (
    channel &&
    voucher.allowedChannels.length > 0 &&
    !voucher.allowedChannels.some((c) => same(c, channel))
  )
    throw new BadRequestException('Voucher não válido para este canal');

  if (
    voucher.applicablePlans.length > 0 &&
    !voucher.applicablePlans.includes(offer.id)
  )
    throw new BadRequestException('Voucher não é válido para esta oferta');
  if (
    voucher.allowedLinkCodes.length > 0 &&
    !voucher.allowedLinkCodes.some((c) => same(c, offer.code))
  )
    throw new BadRequestException('Voucher não é válido para esta oferta');

  let discount =
    voucher.discountType === 'PERCENTAGE'
      ? Math.round((amountCents * voucher.discountValue) / 100)
      : Math.round(voucher.discountValue * 100);
  if (voucher.discountType === 'PERCENTAGE' && voucher.maxDiscountValue != null)
    discount = Math.min(discount, Math.round(voucher.maxDiscountValue * 100));
  discount = Math.max(0, Math.min(discount, amountCents));

  return {
    valid: true,
    voucherId: voucher.id,
    code: voucher.code,
    discountType: voucher.discountType,
    discountValue: voucher.discountValue,
    originalAmountCents: amountCents,
    discountAmountCents: discount,
    finalAmountCents: amountCents - discount,
  };
}

/** Prisma surface the voucher helpers need (real client, transaction client or a test fake). */
type VoucherDb = {
  voucher: { findFirst: (args: any) => Promise<any> };
};

/**
 * Loads the voucher `code` of the offer owner and quotes it against `amountCents`.
 * Read-only: the use is only consumed once the charge is paid (`recordVoucherUsageOnce`).
 */
export async function findOfferVoucherQuote(
  db: VoucherDb,
  offer: VoucherOfferTarget & { ownerUserId: string },
  code: string,
  amountCents: number,
  now = new Date(),
): Promise<OfferVoucherQuote> {
  const finalCode = (code ?? '').toUpperCase().trim();
  if (!finalCode)
    throw new BadRequestException('Código do voucher não informado');
  const voucher = (await db.voucher.findFirst({
    where: { userId: offer.ownerUserId, code: finalCode },
  })) as VoucherRow | null;
  return quoteOfferVoucher(voucher, offer, amountCents, now);
}

export type VoucherUsageInput = {
  voucherId: string;
  transactionId: string;
  subscriptionId?: string | null;
  customerEmail: string;
  customerDocument: string;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
};

/**
 * Records the use of a voucher for one paid transaction, once. The unique key
 * (voucherId, transactionId) turns repeated webhooks and settle events into no-ops, and the
 * counter only moves when the usage row was actually created. Returns whether it counted.
 */
export async function recordVoucherUsageOnce(
  prisma: {
    $transaction: (fn: (p: any) => Promise<boolean>) => Promise<boolean>;
  },
  dto: VoucherUsageInput,
): Promise<boolean> {
  return prisma.$transaction(async (p) => {
    const created = await p.voucherUsage.createMany({
      data: [
        {
          voucherId: dto.voucherId,
          transactionId: dto.transactionId,
          subscriptionId: dto.subscriptionId ?? null,
          customerEmail: dto.customerEmail,
          customerDocument: dto.customerDocument,
          originalAmount: dto.originalAmount,
          discountAmount: dto.discountAmount,
          finalAmount: dto.finalAmount,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count !== 1) return false;
    await p.voucher.update({
      where: { id: dto.voucherId },
      data: { usageCount: { increment: 1 } },
    });
    return true;
  });
}
