import { describe, expect, it } from 'bun:test';
import {
  compareLanes,
  deliveryLaneId,
  readDeliveryFees,
} from './delivery-fee-settings';
import { parseDomNegotiation } from '../financial-policy/dom-negotiation';

describe('delivery fee lanes', () => {
  it('exposes imported effective acquirer costs without changing the response contract', async () => {
    const fees = parseDomNegotiation({
      negotiation: {
        credit: {
          fee_transaction: 1,
          installments: Array.from({ length: 12 }, (_, index) => ({
            installment: index + 1,
            mdr: 3.99,
            interest_rate_our: index === 0 ? 0 : index === 11 ? 12.01 : 4.31,
            effective_rate: index === 0 ? 3.99 : index === 11 ? 16 : 8.3,
          })),
        },
        pix_online: { mdr: 0.98, fee_transaction: 1 },
        boleto: { mdr: 3.49, mdr_type: 'FIXED', fee_transaction: 1 },
      },
    });
    const tx = {
      deliveryPlatformRegistration: {
        findUnique: async () => ({ platformId: 'platform' }),
      },
      platform: {
        findUniqueOrThrow: async () => ({
          id: 'platform',
          ownerUserId: 'owner',
          tag: 'SHOP',
          deliveryDisabledLanes: [],
          deliveryFeeMode: 'ADDITIVE_ONLY',
        }),
      },
      additiveFee: { findMany: async () => [] },
      platformAdditiveFee: { findMany: async () => [] },
      financialPolicyRevision: { findMany: async () => [] },
      acquirerCatalogue: { findMany: async () => [{ code: 'DOM' }] },
      acquirerFeeSchedule: {
        findMany: async ({
          where,
        }: {
          where: { method: string; channel: string; installments: number };
        }) =>
          fees
            .filter(
              (fee) =>
                fee.method === where.method &&
                fee.channel === where.channel &&
                fee.installments === where.installments,
            )
            .map((fee) => ({
              ...fee,
              acquirerCode: 'DOM',
              source: 'SYNC',
              createdAt: new Date(),
            })),
      },
    } as unknown as Parameters<typeof readDeliveryFees>[0];
    const result = await readDeliveryFees(tx, 'company');
    expect(Object.keys(result).sort()).toEqual([
      'additiveFees',
      'costs',
      'coverage',
      'disabledLanes',
      'lanes',
      'mode',
      'underCovered',
      'version',
    ]);
    expect(result.costs).toHaveLength(13);
    expect(result.costs.find((fee) => fee.method === 'PIX')?.ratePpm).toBe(
      9_800,
    );
    for (const installments of [1, 2, 6, 12]) {
      expect(
        result.costs.find((fee) => fee.installments === installments),
      ).toEqual({
        method: 'CREDIT_CARD',
        channel: 'ONLINE',
        installments,
        fixedCents: 100,
        ratePpm:
          installments === 1 ? 39_900 : installments === 12 ? 160_000 : 83_000,
      });
    }
  });

  it('orders methods first and installments numerically', () => {
    const lanes = [
      { method: 'PIX', installments: 1 },
      { method: 'CREDIT_CARD', installments: 10 },
      { method: 'CREDIT_CARD', installments: 2 },
      { method: 'DEBIT_CARD', installments: 1 },
      { method: 'CREDIT_CARD', installments: 1 },
      { method: 'CREDIT_CARD', installments: 12 },
    ] as const;
    expect([...lanes].sort(compareLanes).map(deliveryLaneId)).toEqual([
      'CREDIT_CARD/1',
      'CREDIT_CARD/2',
      'CREDIT_CARD/10',
      'CREDIT_CARD/12',
      'DEBIT_CARD/1',
      'PIX/1',
    ]);
  });
});
