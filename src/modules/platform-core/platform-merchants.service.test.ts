import { describe, test, expect, mock } from 'bun:test';
import { PlatformMerchantsService } from './platform-merchants.service';
import { resolveLegacyMerchantPlatform } from '../integrations/legacy-merchant-platform';

const context = { id: 'platform-a', tag: 'CLIENT-A', ownerUserId: 'owner', acquirer: 'DOM' as const };
function fixture() {
  const prisma = { user: { findUnique: mock(async () => ({ id: 'merchant-user', isActive: true, isPurged: false })) }, integrationMerchant: { findUnique: mock(async () => ({ userId: 'merchant-user', user: { isActive: true, isPurged: false } })), upsert: mock(async () => ({ id: 'merchant' })) } };
  const payments = { createForMerchant: mock(async () => ({ amountCents: 100 })) };
  const finance = {};
  return { prisma, payments, service: new PlatformMerchantsService(prisma as never, payments as never, finance as never) };
}
describe('Explicit platform merchants', () => {
  test('provisions association to existing active account without creating a technical user', async () => {
    const { service, prisma } = fixture();
    await service.provision(context, 'external', { cnpj: '10.802.530/0001-07', legalName: 'Merchant' });
    expect(prisma.integrationMerchant.upsert.mock.calls[0][0].create).toMatchObject({ integrationKey: 'platform:platform-a', userId: 'merchant-user', cnpj: '10802530000107' });
  });
  test('missing registered account cannot be auto-created', async () => {
    const { service, prisma } = fixture(); prisma.user.findUnique.mockResolvedValue(null as never);
    await expect(service.provision(context, 'external', { cnpj: '10802530000107', legalName: 'Merchant' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.integrationMerchant.upsert).not.toHaveBeenCalled();
  });
  test('merchant resolution always uses authenticated platform namespace', async () => {
    const { service, prisma } = fixture(); await service.resolve(context, 'external');
    expect(prisma.integrationMerchant.findUnique.mock.calls[0][0]).toMatchObject({ where: { integrationKey_externalMerchantId: { integrationKey: 'platform:platform-a', externalMerchantId: 'external' } } });
  });
  test('legacy keys require exactly one explicit binding and never infer Zero Grau', async () => {
    const prisma = { platformIntegration: { findMany: mock(async () => []) } };
    await expect(resolveLegacyMerchantPlatform(prisma as never, 'sim-delivery_zero-grau')).rejects.toMatchObject({ status: 422 });
    prisma.platformIntegration.findMany.mockResolvedValue([{ url: 'sim-delivery_zero-grau', platform: { tag: 'CLIENT-A' } }] as never);
    expect(await resolveLegacyMerchantPlatform(prisma as never, 'sim-delivery_zero-grau')).toEqual({ tag: 'CLIENT-A' });
  });
});
