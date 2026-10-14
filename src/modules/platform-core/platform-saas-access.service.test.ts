import { expect, mock, test } from 'bun:test';
import { PlatformSaasAccessService } from './platform-saas-access.service';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';
import { AdminController } from '../../presentation/controllers/admin.controller';
function fixture() {
  const row = { id: 'subscriber', platformTag: 'CONTROLE-MOTORISTA', customerEmail: 'buyer@example.com', customerName: 'Buyer', isActive: true, frozenDays: 0, expiresAt: new Date(Date.now() + 86400000 * 5), totalDaysCredited: 10, createdAt: new Date() };
  const prisma: any = {
    platform: { findUnique: async () => ({ isActive: true, owner: { isActive: true } }) },
    platformSubscriberAccess: { findMany: mock(async () => [row]), count: async () => 1, findUnique: mock(async () => row), updateMany: mock(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }) },
  };
  return { row, prisma, service: new PlatformSaasAccessService(prisma) };
}
test('legacy SaaS list and canonical list project same shared result', async () => {
  const { prisma } = fixture();
  const alias = Object.assign(Object.create(AdminController.prototype), { prisma });
  const context = { id: 'p', tag: 'CONTROLE-MOTORISTA', ownerUserId: 'owner', acquirer: 'DOM' as const };
  const canonical = new PlatformSubscriptionCapabilitiesService(prisma, { resolve: async () => context } as any, {} as any);
  expect(await alias.listPlataformaUsuarios(context.tag, 'active', '1', '20')).toEqual(await canonical.subscribers(context, 'active', '1', '20'));
  expect(prisma.platformSubscriberAccess.findMany.mock.calls[0][0].where).toEqual({ platformTag: context.tag, isActive: true });
});
test('foreign SaaS subscriber ID cannot toggle another product', async () => {
  const { row, prisma, service } = fixture();
  row.platformTag = 'CONTROLE-PATRIMONIAL';
  await expect(service.toggle('CONTROLE-MOTORISTA', row.id)).rejects.toThrow('Assinante não encontrado');
  expect(prisma.platformSubscriberAccess.updateMany).not.toHaveBeenCalled();
});
test('toggle freezes days once and rejects concurrent mutation', async () => {
  const { row, prisma, service } = fixture();
  const result = await service.toggle('CONTROLE-MOTORISTA', row.id);
  expect(result).toMatchObject({ toggled: true, isActive: false, frozenDays: 5 });
  expect(prisma.platformSubscriberAccess.updateMany.mock.calls[0][0].where).toMatchObject({ platformTag: 'CONTROLE-MOTORISTA', isActive: true, frozenDays: 0 });
  prisma.platformSubscriberAccess.updateMany.mockImplementation(async () => ({ count: 0 }));
  await expect(service.toggle('CONTROLE-MOTORISTA', row.id)).rejects.toThrow('Acesso alterado por outra operação');
});
