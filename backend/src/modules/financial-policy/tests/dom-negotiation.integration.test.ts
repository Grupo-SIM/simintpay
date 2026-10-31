import { describe, expect, test } from 'bun:test';
import { parseDomNegotiation } from '../dom-negotiation';
import {
  estimatedCost,
  orderByCost,
  validateFee,
  type AcquirerCost,
} from '../acquirer-fees';

const response = {
  user: { email: 'private@example.invalid', mfa_name: 'secret' },
  negotiation: {
    credit: {
      fee_transaction: 1,
      installments: Array.from({ length: 12 }, (_, i) => ({
        installment: i + 1,
        mdr: 3.99,
        fees: i === 0 ? 0 : 4.51,
        effective_rate: i === 0 ? 3.99 : 8.3,
        interest_rate_our: i === 0 ? 0 : 4.31,
      })),
    },
    pix_online: { mdr: 0.98, fee_transaction: 1 },
    boleto: { mdr: 3.49, mdr_type: 'FIXED', fee_transaction: 1 },
  },
};

describe('DOM negotiation import', () => {
  test('maps credit 1x, installment interest, PIX and fixed boleto without identity data', () => {
    const fees = parseDomNegotiation(response);
    expect(fees).toHaveLength(14);
    expect(fees[0]).toEqual({
      method: 'CREDIT_CARD',
      channel: 'ONLINE',
      installments: 1,
      fixedCents: 100,
      ratePpm: 39_900,
      interestPpm: 0,
      base: 'BUYER_TOTAL',
    });
    expect(fees[1]).toMatchObject({
      installments: 2,
      ratePpm: 39_900,
      interestPpm: 43_100,
    });
    expect(fees[12]).toMatchObject({
      method: 'PIX',
      fixedCents: 100,
      ratePpm: 9_800,
    });
    expect(fees[13]).toMatchObject({
      method: 'BOLETO',
      fixedCents: 449,
      ratePpm: 0,
    });
    expect(JSON.stringify(fees)).not.toContain('private@example.invalid');
    fees.forEach(validateFee);
  });

  test('rejects incomplete or inconsistent rates before persisting anything', () => {
    expect(() =>
      parseDomNegotiation({
        ...response,
        negotiation: {
          ...response.negotiation,
          credit: {
            ...response.negotiation.credit,
            installments: response.negotiation.credit.installments.slice(0, 11),
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseDomNegotiation({
        ...response,
        negotiation: {
          ...response.negotiation,
          credit: {
            ...response.negotiation.credit,
            installments: [
              {
                ...response.negotiation.credit.installments[0],
                effective_rate: 0,
              },
              ...response.negotiation.credit.installments.slice(1),
            ],
          },
        },
      }),
    ).toThrow();
  });

  test('orders acquirers by monetary cost, not raw percentages', () => {
    const base: AcquirerCost = {
      acquirer: 'DOM',
      fixedCents: 100,
      ratePpm: 39_900,
      interestPpm: 0,
      base: 'BUYER_TOTAL',
      source: 'SYNC',
      createdAt: new Date(),
    };
    const alternative = {
      ...base,
      acquirer: 'OTHER',
      fixedCents: 0,
      ratePpm: 45_000,
    };
    expect(
      orderByCost([alternative, base], 10_000, 10_000).map(
        (fee) => fee.acquirer,
      ),
    ).toEqual(['OTHER', 'DOM']);
    expect(estimatedCost(base, 10_000, 10_000)).toBe(499);
  });
});
