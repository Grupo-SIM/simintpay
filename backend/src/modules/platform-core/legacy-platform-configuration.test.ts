import { expect, mock, test } from 'bun:test';
import { AdminController } from '../../presentation/controllers/admin.controller';
function fixture() {
  const platformTaxas = {
    getTaxasResponse: mock(async (tags?: string[]) => ({
      tags,
      data: { TAXA_SAQUE_FIXA: 2, TAXA_SAQUE_PERCENT: 0.01 },
    })),
    patchPlatform: mock(async (tag: string, body: unknown) => ({ tag, body })),
    getResolvedTaxaForTag: mock((tag: string) => ({
      data: { TAXA_SAQUE_PERCENT: 0.01, tag },
      sources: { secret: true },
    })),
  };
  const prisma = {
    user: {
      findUnique: mock(async () => ({
        id: 'user',
        email: 'client@example.com',
        platform: null as any,
      })),
      findMany: mock(async () => [
        { email: 'CLIENT@EXAMPLE.COM', name: null },
        { email: 'next@example.com', name: 'Next' },
      ]),
    },
  };
  const controller: AdminController = Object.assign(
    Object.create(AdminController.prototype),
    { prisma, platformTaxas },
  );
  return { controller, platformTaxas, prisma };
}
test('legacy platform fee configuration preserves raw decimal rates and delegates unchanged', async () => {
  const { controller, platformTaxas } = fixture();
  expect(await controller.listPlatformTaxas()).toEqual({
    tags: undefined,
    data: { TAXA_SAQUE_FIXA: 2, TAXA_SAQUE_PERCENT: 0.01 },
  });
  expect(
    await controller.getPlatformTaxasByTag('CLIENT:client@example.com'),
  ).toMatchObject({ tags: ['CLIENT:client@example.com'] });
  const body = { TAXA_SAQUE_FIXA: 0.29, TAXA_SAQUE_PERCENT: 0.01 };
  expect(await controller.patchPlatformTaxas('SHOP', body)).toEqual({
    tag: 'SHOP',
    body,
  });
  expect(platformTaxas.patchPlatform.mock.calls[0]).toEqual(['SHOP', body]);
});
test('legacy personal fees preserve membership choice and exclude administration metadata', async () => {
  const { controller, prisma } = fixture();
  expect(await controller.getMinhasTaxas({ sub: 'user' } as any)).toEqual({
    email: 'client@example.com',
    platform: 'SIM INT PAY',
    data: { TAXA_SAQUE_PERCENT: 0.01, tag: 'USER:USER' },
  });
  prisma.user.findUnique.mockResolvedValue({
    id: 'user',
    email: 'client@example.com',
    platform: { tag: 'BOSQUE' },
  });
  expect(await controller.getMinhasTaxas({ sub: 'user' } as any)).toMatchObject(
    { platform: 'BOSQUE', data: { tag: 'BOSQUE' } },
  );
  await expect(controller.getMinhasTaxas(undefined)).rejects.toThrow(
    'não autenticado',
  );
  prisma.user.findUnique.mockResolvedValue(null as any);
  await expect(
    controller.getMinhasTaxas({ sub: 'missing' } as any),
  ).rejects.toThrow('não encontrado');
});
test('legacy client configuration preserves document search, paging and email case contract', async () => {
  const { controller, prisma } = fixture();
  expect(
    await controller.listSimIntPayClientes('  123.456  ', '2', '1'),
  ).toEqual({
    data: [{ email: 'client@example.com', name: null }],
    page: 2,
    pageSize: 1,
    hasMore: true,
  });
  expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
    where: {
      role: 'USER',
      platformId: null,
      OR: [
        { email: { contains: '123.456' } },
        { name: { contains: '123.456' } },
        { cpf: { contains: '123456' } },
        { cnpj: { contains: '123456' } },
      ],
    },
    skip: 1,
    take: 2,
  });
});
