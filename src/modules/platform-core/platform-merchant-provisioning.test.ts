import { expect, mock, test } from 'bun:test';
import { PlatformMerchantProvisioning } from './platform-merchant-provisioning';

function fixture(existing = false, conflict = false) {
  const prisma = {
    user: {
      findUnique: mock(async ({ where }: any) => where.id ? { id: 'user', isActive: true } : { id: conflict ? 'other' : 'user', isActive: true }),
      update: mock(async ({ data }: any) => data),
    },
    integrationMerchant: {
      findUnique: mock(async ({ where }: any) => where.integrationKey_externalMerchantId && existing ? { id: 'merchant', userId: 'user' } : null),
      create: mock(async ({ data }: any) => data),
      update: mock(async ({ data }: any) => data),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, service: new PlatformMerchantProvisioning(prisma as never) };
}

test('links existing CPF account using cpf rather than cnpj', async () => {
  const { prisma, service } = fixture();
  const merchant = await service.provision('sim-delivery_shop', 'company', { cnpj: '529.982.247-25', legalName: 'Shop' });
  expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { cpf: '52998224725' } });
  expect(merchant).toMatchObject({ cnpj: '52998224725', userId: 'user' });
});

test('updates merchant owner document according to person type', async () => {
  for (const [cnpj, expected] of [
    ['52998224725', { cpf: '52998224725', cnpj: null, isCompany: false }],
    ['10802530000107', { cpf: null, cnpj: '10802530000107', isCompany: true }],
  ] as const) {
    const { prisma, service } = fixture(true);
    await service.provision('sim-delivery_shop', 'company', { cnpj, legalName: 'Shop' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject(expected);
  }
});

test('rejects conflicting CPF and invalid documents before updates', async () => {
  const { prisma, service } = fixture(true, true);
  await expect(service.provision('sim-delivery_shop', 'company', { cnpj: '52998224725', legalName: 'Shop' })).rejects.toMatchObject({ status: 409 });
  for (const cnpj of ['123', '52998224724', '10802530000108', '11111111111']) {
    await expect(service.provision('sim-delivery_shop', 'company', { cnpj, legalName: 'Shop' })).rejects.toMatchObject({ status: 400 });
  }
  expect(prisma.user.update).not.toHaveBeenCalled();
});
