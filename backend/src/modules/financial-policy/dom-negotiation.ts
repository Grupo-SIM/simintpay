import { BadRequestException } from '@nestjs/common';
import type { FeeInput } from './acquirer-fees';

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

/** Only the negotiation subtree is accepted; user identity from the DOM response is discarded. */
export function parseDomNegotiation(response: unknown): FeeInput[] {
  const negotiation = object(object(response).negotiation);
  const credit = object(negotiation.credit);
  const installments = credit.installments;
  if (!Array.isArray(installments) || installments.length !== 12)
    throw new BadRequestException('Parcelas DOM incompletas');
  const rows: FeeInput[] = installments.map((value) => {
    const row = object(value);
    const n = number(row.installment);
    if (!Number.isInteger(n) || n < 1 || n > 12)
      throw new BadRequestException('Parcela DOM inválida');
    // Absorbing interest: effective_rate includes MDR and installment interest on buyer total.
    const ratePpm = ppm(row.mdr);
    const interestPpm = ppm(row.interest_rate_our);
    if (Math.abs(ratePpm + interestPpm - ppm(row.effective_rate)) > 100)
      throw new BadRequestException('Taxas DOM inconsistentes');
    return {
      method: 'CREDIT_CARD',
      channel: 'ONLINE',
      installments: n,
      fixedCents: fixed(credit.fee_transaction),
      ratePpm,
      interestPpm,
      base: 'BUYER_TOTAL',
    };
  });
  if (new Set(rows.map((row) => row.installments)).size !== 12)
    throw new BadRequestException('Parcelas DOM duplicadas');
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
  return rows;
}
