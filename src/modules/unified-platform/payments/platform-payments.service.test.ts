import { describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformPaymentsService } from './platform-payments.service';
import { encryptPlatformSecret } from '../../platform-integrations/platform-secrets';

const context = { id: 'platform', tag: 'CLIENT', ownerUserId: 'owner', acquirer: 'DOM' as const };
const input = { amountCents: 12345, paymentMethod: 'PIX' as const, idempotencyKey: 'purchase-1', customer: { name: 'Maria Silva', email: 'maria@example.com', document: '52998224725', documentType: 'CPF' as const } };

function fixture(acquirer: 'DOM' | 'FRENDZ' = 'DOM') {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  const platform = { ...context, acquirer, isActive: true, owner: { isActive: true, isPurged: false }, integrations: [{ key: acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN', encryptedValue: encryptPlatformSecret('mock-token') }] };
  let stored: any;
  const prisma = {
    platformTaxaOverride: { findMany: mock(async () => []) },
    platform: { findUnique: mock(async () => platform) },
    wallet: { findUnique: mock(async () => ({ id: 'wallet' })) },
    transaction: {
      findUnique: mock(async () => stored ?? null),
      create: mock(async ({ data }: any) => { stored = data; return stored; }),
      update: mock(async ({ data }: any) => { stored = { ...stored, ...data }; return stored; }),
    },
  };
  const charge = mock(async () => ({ id: 'gateway-payment', status: 'pending', amount: 123.45, pixContent: 'mock-pix', qrCode: 'mock-qr', pixExpire: null }));
  const gateways = { byAcquirer: mock(() => ({ createPixCheckout: charge })) };
  return { service: new PlatformPaymentsService(prisma as never, gateways as never), prisma, platform, charge, gateways };
}

describe('platform payment core', () => {
  test('DOM receives reais and canonical output preserves integer cents', async () => {
    const { service, charge, prisma } = fixture();
    expect(await service.create(context, input)).toMatchObject({ amountCents: 12345, paymentId: 'gateway-payment' });
    expect((charge.mock.calls as any)[0][1].amount).toBe(123.45);
    expect((prisma.transaction.create.mock.calls as any)[0][0].data.amount).toEqual(new Prisma.Decimal('123.45'));
  });

  test('Frendz receives cents without silently selecting DOM', async () => {
    const { service, charge, gateways } = fixture('FRENDZ');
    await service.create({ ...context, acquirer: 'FRENDZ' }, input);
    expect((charge.mock.calls as any)[0][1].amount).toBe(12345);
    expect(gateways.byAcquirer).toHaveBeenCalledWith('FRENDZ');
  });

  test('same key replays stored payment without another charge', async () => {
    const { service, charge } = fixture();
    const result = await service.create(context, input);
    expect(await service.create(context, input)).toEqual(result);
    expect(charge).toHaveBeenCalledTimes(1);
    await expect(service.create(context, { ...input, amountCents: 12346 })).rejects.toThrow();
    expect(charge).toHaveBeenCalledTimes(1);
  });

  test('corporate contract without adapter cannot silently fall back to generic payment', async () => {
    const { service, platform, charge, prisma } = fixture();
    platform.tag = 'CONTROLE-MOTORISTA';
    await expect(service.create({ ...context, tag: 'CONTROLE-MOTORISTA' }, input)).rejects.toMatchObject({ status: 422 });
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('ownership change and inactive owners block writes', async () => {
    const { service, platform, charge, prisma } = fixture();
    platform.ownerUserId = 'new-owner';
    await expect(service.create(context, input)).rejects.toThrow();
    platform.ownerUserId = 'owner';
    platform.owner.isActive = false;
    await expect(service.create(context, input)).rejects.toThrow();
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('unknown method and invalid cents never create a draft or charge', async () => {
    const { service, charge, prisma } = fixture();
    await expect(service.create(context, { ...input, paymentMethod: 'CREDIT_CARD' as never })).rejects.toThrow();
    await expect(service.create(context, { ...input, amountCents: 1.5 })).rejects.toThrow();
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('uncertain gateway failure blocks retries instead of issuing another charge', async () => {
    const { service, charge } = fixture();
    charge.mockImplementation(async () => { throw new Error('timeout'); });
    await expect(service.create(context, input)).rejects.toThrow('timeout');
    await expect(service.create(context, input)).rejects.toThrow();
    expect(charge).toHaveBeenCalledTimes(1);
  });
});
