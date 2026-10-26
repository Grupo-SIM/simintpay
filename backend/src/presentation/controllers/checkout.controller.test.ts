import { expect, test } from 'bun:test';
import { CheckoutController } from './checkout.controller';
import { emptyPolicy } from '../../modules/financial-policy/financial-policy';

test('public rates expose buyer charges only, including active policy version', async () => {
  const policy = emptyPolicy();
  for (let n = 1; n <= 12; n++) {
    const key = `DOM/CREDIT_CARD/ONLINE/${n}`;
    policy.lanes[key] = { active: true, contract: { fixedCents: 100, ratePpm: 30000, cashbackCents: 25, interestPpm: 20000, base: 'ORIGINAL', reference: 'private-contract' }, sim: { fixedCents: 0, ratePpm: 10000, interestPpm: 10000 } };
    policy.owner[key] = { fixedCents: 50, ratePpm: 10000, passInterestPpm: 1000000 };
  }
  const controller = { prisma: { platform: { findUnique: async () => ({ acquirer: 'DOM' }) }, financialPolicyRevision: { findMany: async () => [{ tag: 'SHOP', version: 1, document: policy }] } } };
  const result = await CheckoutController.prototype.getCcRates.call(controller as any, 'SHOP');
  expect(result.version).toBe('0:1');
  expect(result.installments).toHaveLength(12);
  expect(result.installments[0]).toEqual({ n: 1, buyerRate: 0.03, fixedFee: 0 });
  expect(JSON.stringify(result)).not.toMatch(/domRate|domCcRate|masterRate|private-contract|cashback|simMargin|vendorCc/);
});
