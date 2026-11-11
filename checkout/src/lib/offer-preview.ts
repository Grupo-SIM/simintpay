import type { PublicOffer } from './offer-checkout-model';

/** Preview accepts only public display fields, never credentials or callbacks. */
export function isOfferPreviewMessage(
  value: unknown,
): value is { draft: PublicOffer } {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (
    message.type !== 'payment-link-preview:draft' ||
    message.version !== 1 ||
    !message.draft ||
    typeof message.draft !== 'object'
  )
    return false;
  const d = message.draft as Record<string, unknown>;
  const keys = [
    'code',
    'name',
    'description',
    'amountCents',
    'acceptedMethods',
    'maxInstallments',
    'renewalMode',
    'intervalType',
    'intervalCount',
    'trialDays',
    'pricing',
    'bumps',
  ];
  return (
    validPricing(d.pricing, Number(d.maxInstallments)) &&
    validBumps(d.bumps) &&
    Object.keys(d).length === keys.length &&
    keys.every((key) => Object.hasOwn(d, key)) &&
    d.code === 'preview' &&
    typeof d.name === 'string' &&
    d.name.length <= 500 &&
    typeof d.description === 'string' &&
    d.description.length <= 10000 &&
    Number.isSafeInteger(d.amountCents) &&
    Number(d.amountCents) >= 0 &&
    Number(d.amountCents) <= 1e11 &&
    Array.isArray(d.acceptedMethods) &&
    d.acceptedMethods.length <= 4 &&
    d.acceptedMethods.every((m) =>
      ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'].includes(m),
    ) &&
    Number.isInteger(d.maxInstallments) &&
    Number(d.maxInstallments) >= 1 &&
    Number(d.maxInstallments) <= 12 &&
    ['NONE', 'AUTO_CHARGE', 'MANUAL_PAY'].includes(String(d.renewalMode)) &&
    ['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(String(d.intervalType)) &&
    Number.isSafeInteger(d.intervalCount) &&
    Number(d.intervalCount) >= 1 &&
    Number.isSafeInteger(d.trialDays) &&
    Number(d.trialDays) >= 0
  );
}

export function validPricing(value: unknown, max: number) {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const money = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
  return (
    money(p.pixAmount) &&
    money(p.debitAmount) &&
    Array.isArray(p.options) &&
    p.options.length <= max &&
    p.options.every(
      (o, i) =>
        o &&
        typeof o === 'object' &&
        o.installments === i + 1 &&
        money(o.totalAmount) &&
        money(o.installmentAmount) &&
        money(o.interestAmount) &&
        Math.abs(o.installmentAmount * o.installments - o.totalAmount) <=
          o.installments * 0.011,
    )
  );
}

function validBumps(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every(
      (b) =>
        b &&
        typeof b === 'object' &&
        typeof b.code === 'string' &&
        b.role === 'BUMP' &&
        typeof b.name === 'string' &&
        b.name.length <= 500 &&
        (b.description === null ||
          (typeof b.description === 'string' &&
            b.description.length <= 10000)) &&
        Number.isSafeInteger(b.amountCents) &&
        b.amountCents >= 0,
    )
  );
}
