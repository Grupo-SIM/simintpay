import { beforeAll, describe, expect, test } from 'bun:test';
import { makeOfferDb } from './offer-checkout.fixture';
import { PIX_LANE_POLICY, useEmptyCaches } from './offer-charge.fixture';
import { OfferService } from './offer.service';

const existing = {
  id: 'o1',
  ownerUserId: 'u1',
  platformTag: null,
  amountCents: 5000,
  acceptedMethods: ['PIX'],
  maxInstallments: 1,
  renewalMode: 'NONE',
  intervalType: null,
  intervalCount: null,
  repetitions: null,
  trialDays: 3,
  retryDays: 2,
  graceDays: 1,
  metadata: null,
  expiresAt: new Date('2027-01-01'),
  maxUses: 10,
};

beforeAll(useEmptyCaches);

function service() {
  const updates: any[] = [];
  // The offer floor is derived from the financial policy and acquirer fees on every update.
  const db = makeOfferDb(existing);
  const policy = structuredClone(PIX_LANE_POLICY);
  db.prisma.financialPolicyRevision.findMany = async () => [
    { tag: 'GLOBAL', version: 1, document: policy },
  ];
  const prisma: any = {
    ...db.prisma,
    offer: {
      findUnique: async () => existing,
      update: async (args: any) => {
        updates.push(args.data);
        return { ...existing, ...args.data };
      },
    },
  };
  const users: any = { findById: async () => ({ id: 'u1' }) };
  return { updates, svc: new OfferService(prisma, users) };
}

describe('OfferService.update clearing optional fields', () => {
  test('omitted fields keep the stored values', async () => {
    const { svc, updates } = service();
    await svc.update({ id: 'u1', role: 'USER' }, 'o1', { name: 'Novo' });
    expect(updates[0]).toMatchObject({
      trialDays: 3,
      retryDays: 2,
      graceDays: 1,
      expiresAt: undefined,
      maxUses: undefined,
    });
  });

  test('isActive reactivates and get is owner scoped', async () => {
    const { svc, updates } = service();
    await svc.update({ id: 'u1', role: 'USER' }, 'o1', { isActive: true });
    expect(updates[0].isActive).toBe(true);
    expect((await svc.get({ id: 'u1', role: 'USER' }, 'o1')).id).toBe('o1');
    expect((await svc.get({ id: 'a', role: 'ADMIN' }, 'o1')).id).toBe('o1');
    await expect(svc.get({ id: 'u2', role: 'USER' }, 'o1')).rejects.toThrow(
      'Oferta não encontrada',
    );
  });

  test('null clears expiry, limits and day counters', async () => {
    const { svc, updates } = service();
    await svc.update({ id: 'u1', role: 'USER' }, 'o1', {
      expiresAt: null,
      maxUses: null,
      trialDays: null,
      retryDays: null,
      graceDays: null,
    });
    expect(updates[0]).toMatchObject({
      expiresAt: null,
      maxUses: null,
      trialDays: null,
      retryDays: null,
      graceDays: null,
    });
  });
});
