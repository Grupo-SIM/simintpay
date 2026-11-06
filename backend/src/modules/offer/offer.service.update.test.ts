import { describe, expect, test } from 'bun:test';
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
  accessDays: 30,
  metadata: null,
  expiresAt: new Date('2027-01-01'),
  maxUses: 10,
};

function service() {
  const updates: any[] = [];
  const prisma: any = {
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
      accessDays: 30,
      trialDays: 3,
      retryDays: 2,
      graceDays: 1,
      expiresAt: undefined,
      maxUses: undefined,
    });
  });

  test('null clears expiry, limits and day counters', async () => {
    const { svc, updates } = service();
    await svc.update({ id: 'u1', role: 'USER' }, 'o1', {
      expiresAt: null,
      maxUses: null,
      accessDays: null,
      trialDays: null,
      retryDays: null,
      graceDays: null,
    });
    expect(updates[0]).toMatchObject({
      expiresAt: null,
      maxUses: null,
      accessDays: null,
      trialDays: null,
      retryDays: null,
      graceDays: null,
    });
  });
});
