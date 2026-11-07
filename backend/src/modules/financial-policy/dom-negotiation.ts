import { BadRequestException } from '@nestjs/common';
import { validateFee, type FeeInput } from './acquirer-fees';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Negociação DOM inválida');
  return value as Record<string, unknown>;
};
const number = (value: unknown) => {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100000)
    throw new BadRequestException('Taxa DOM inválida');
  return n;
};
const ppm = (value: unknown) => Math.round(number(value) * 10_000);
const fixed = (value: unknown) => Math.round(number(value) * 100);

const installmentRows = (value: unknown) => {
  if (!Array.isArray(value) || value.length !== 12)
    throw new BadRequestException('Parcelas DOM incompletas');
  const rows = value.map(object);
  const numbers = rows.map((row) => number(row.installment));
  if (numbers.some((n) => !Number.isInteger(n) || n < 1 || n > 12))
    throw new BadRequestException('Parcela DOM inválida');
  if (new Set(numbers).size !== 12)
    throw new BadRequestException('Parcelas DOM duplicadas');
  return rows;
};

const creditRate = (value: unknown) => {
  const row = object(value);
  const ratePpm = ppm(row.mdr);
  const interestPpm = ppm(row.interest_rate_our);
  if (Math.abs(ratePpm + interestPpm - ppm(row.effective_rate)) > 100)
    throw new BadRequestException('Taxas DOM inconsistentes');
  return { ratePpm, interestPpm };
};

const brands = (value: unknown) => {
  const rows = Object.entries(object(value));
  if (
    !rows.length ||
    !rows.some(([brand]) => brand === 'VISA') ||
    !rows.some(([brand]) => brand === 'MASTERCARD') ||
    !rows.some(([brand]) => brand === 'OTHERS')
  )
    throw new BadRequestException('Bandeiras DOM incompletas');
  return rows.map(([brand, rate]) => ({ brand, rate: object(rate) }));
};

/** Only the negotiation subtree is accepted; user identity from the DOM response is discarded. */
export function parseDomNegotiation(response: unknown): FeeInput[] {
  const negotiation = object(object(response).negotiation);
  const credit = object(negotiation.credit);
  const rows: FeeInput[] = installmentRows(credit.installments).map((row) => ({
    method: 'CREDIT_CARD',
    channel: 'ONLINE',
    installments: number(row.installment),
    fixedCents: fixed(credit.fee_transaction),
    ...creditRate(row),
    base: 'BUYER_TOTAL',
  }));
  const pix = object(negotiation.pix_online);
  rows.push({
    method: 'PIX',
    channel: 'ONLINE',
    installments: 1,
    fixedCents: fixed(pix.fee_transaction),
    ratePpm: ppm(pix.mdr),
    interestPpm: 0,
    base: 'BUYER_TOTAL',
  });
  const boleto = object(negotiation.boleto);
  if (boleto.mdr_type !== 'FIXED')
    throw new BadRequestException('Boleto DOM sem custo fixo');
  rows.push({
    method: 'BOLETO',
    channel: 'ONLINE',
    installments: 1,
    fixedCents: fixed(boleto.mdr) + fixed(boleto.fee_transaction),
    ratePpm: 0,
    interestPpm: 0,
    base: 'ORIGINAL',
  });

  const physicalPix = object(object(negotiation.pix_physical).negotiation);
  rows.push({
    method: 'PIX',
    channel: 'POS',
    installments: 1,
    fixedCents: fixed(physicalPix.fee_transaction),
    ratePpm: ppm(physicalPix.mdr),
    interestPpm: 0,
    base: 'ORIGINAL',
  });
  const physicalDebit = object(negotiation.debit_physical);
  const debitBrands = brands(physicalDebit.brands);
  // DOM exposes no online debit contract: it is priced like the negotiated physical debit.
  rows.push({
    method: 'DEBIT_CARD',
    channel: 'ONLINE',
    installments: 1,
    fixedCents: fixed(physicalDebit.fee_transaction),
    ratePpm: Math.max(...debitBrands.map(({ rate }) => ppm(rate.mdr))),
    interestPpm: 0,
    base: 'ORIGINAL',
  });
  rows.push({
    method: 'DEBIT_CARD',
    channel: 'POS',
    installments: 1,
    fixedCents: fixed(physicalDebit.fee_transaction),
    ratePpm: Math.max(...debitBrands.map(({ rate }) => ppm(rate.mdr))),
    interestPpm: 0,
    base: 'ORIGINAL',
  });
  const physicalCredit = object(negotiation.credit_physical);
  let expectedBrands: string | undefined;
  for (const row of installmentRows(physicalCredit.installments)) {
    const { installment, ...byBrand } = row;
    const rates = brands(byBrand);
    const brandKeys = rates
      .map(({ brand }) => brand)
      .sort()
      .join('/');
    expectedBrands ??= brandKeys;
    if (brandKeys !== expectedBrands)
      throw new BadRequestException('Bandeiras DOM inconsistentes');
    // The schedule has one row per lane. Keep the most expensive whole brand
    // contract, never combine the MDR of one brand with the interest of another.
    const selected = rates
      .map(({ rate }) => creditRate(rate))
      .sort(
        (a, b) =>
          b.ratePpm + b.interestPpm - a.ratePpm - a.interestPpm ||
          b.ratePpm - a.ratePpm,
      )[0]!;
    rows.push({
      method: 'CREDIT_CARD',
      channel: 'POS',
      installments: number(installment),
      fixedCents: fixed(physicalCredit.fee_transaction),
      ...selected,
      base: 'ORIGINAL',
    });
  }
  rows.forEach(validateFee);
  return rows;
}
