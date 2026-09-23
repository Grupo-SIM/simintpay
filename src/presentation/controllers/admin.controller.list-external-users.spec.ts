// `uuid` (v13) é ESM-only e o jest não o transforma por padrão; como este teste não
// exercita nada que use uuid, mockamos para destravar a cadeia de imports do controller.
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
  v5: () => 'test-uuid',
  MAX: '',
  NIL: '',
}));

import { AdminController } from './admin.controller';

/**
 * Regressão: contas criadas em "Criar Conta" (Conta Avulsa) ou por auto-cadastro
 * são Users role=USER sem plataforma externa e sem tenantModule. Antes elas ficavam
 * invisíveis em GET /admin/usuarios ("Leads"). Agora aparecem como plataforma
 * virtual "simintpay".
 *
 * listExternalUsers só depende de `this.prisma`, então instanciamos o método sobre
 * um contexto mínimo com um Prisma mockado — sem subir o módulo Nest inteiro.
 */
describe('AdminController.listExternalUsers — clientes diretos (simintpay)', () => {
  const directClient = {
    id: 'user-tz-1',
    name: 'tz',
    cpf: '12345678901',
    email: 'tz@lucasebarbara.tzviagens.com.br',
    createdAt: new Date('2026-07-13T12:00:00Z'),
    updatedAt: new Date('2026-07-13T12:00:00Z'),
    wallet: { balance: 0, lockedBalance: 0 },
    tenantModule: null,
  };

  // A query de clientes diretos é a única com um filtro { role: 'USER' } dentro do AND.
  const isClientQuery = (arg: any): boolean =>
    Array.isArray(arg?.where?.AND) &&
    arg.where.AND.some((c: any) => c && c.role === 'USER');

  function makeMockPrisma(clientUsers: any[]) {
    return {
      externalPlatformUser: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest
          .fn()
          .mockImplementation(async (arg: any) =>
            isClientQuery(arg) ? clientUsers : [],
          ),
      },
      transaction: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionLink: { findMany: jest.fn().mockResolvedValue([]) },
      subscriptionLinkOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  function invoke(
    prisma: any,
    args: {
      platform?: string;
      page?: string;
      pageSize?: string;
      deleted?: string;
      search?: string;
    } = {},
  ) {
    const ctx = { prisma } as any;
    return (AdminController.prototype as any).listExternalUsers.call(
      ctx,
      args.platform,
      args.page ?? '1',
      args.pageSize ?? '20',
      args.deleted,
      args.search,
    );
  }

  it('inclui conta avulsa (role=USER, sem plataforma) na listagem', async () => {
    const prisma = makeMockPrisma([directClient]);
    const res = await invoke(prisma);

    expect(res.total).toBe(1);
    expect(res.data).toHaveLength(1);
    const row = res.data[0];
    expect(row.id).toBe('user-tz-1');
    expect(row.cpf).toBe('12345678901');
    expect(row.vinculado).toBe(true);
    expect(row.simpayUser?.email).toBe('tz@lucasebarbara.tzviagens.com.br');
    expect(row.platformEntries).toEqual([
      expect.objectContaining({
        platform: 'simintpay',
        email: 'tz@lucasebarbara.tzviagens.com.br',
      }),
    ]);
  });

  it('permite filtrar somente clientes diretos por platform=simintpay', async () => {
    const prisma = makeMockPrisma([directClient]);
    const res = await invoke(prisma, { platform: 'simintpay' });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('user-tz-1');
    expect(
      prisma.user.findMany.mock.calls.some(([a]: any[]) => isClientQuery(a)),
    ).toBe(true);
  });

  it('exclui contas técnicas auto.simpay.com da consulta de clientes diretos', async () => {
    const prisma = makeMockPrisma([directClient]);
    await invoke(prisma);

    const clientCall = prisma.user.findMany.mock.calls.find(([arg]: any[]) =>
      isClientQuery(arg),
    );

    expect(clientCall?.[0]?.where?.AND).toContainEqual({
      NOT: { email: { endsWith: '@auto.simpay.com', mode: 'insensitive' } },
    });
  });

  it('exclui registros externos Platform User sem conta Simintpay vinculada', async () => {
    const prisma = makeMockPrisma([]);
    await invoke(prisma);

    const [[externalCall]] = prisma.externalPlatformUser.findMany.mock.calls;

    expect(externalCall.where.NOT).toEqual({
      AND: [
        { name: { equals: 'Platform User', mode: 'insensitive' } },
        { userId: null },
      ],
    });
  });

  it('NÃO busca clientes diretos ao filtrar por plataforma externa', async () => {
    const prisma = makeMockPrisma([directClient]);
    const res = await invoke(prisma, { platform: 'pagatg' });

    expect(
      prisma.user.findMany.mock.calls.some(([a]: any[]) => isClientQuery(a)),
    ).toBe(false);
    expect(res.data).toHaveLength(0);
  });

  it('busca clientes diretos inativos na aba de contas excluídas', async () => {
    const prisma = makeMockPrisma([directClient]);
    await invoke(prisma, { deleted: 'true' });

    const clientCall = prisma.user.findMany.mock.calls.find(([arg]: any[]) =>
      isClientQuery(arg),
    );
    expect(clientCall).toBeDefined();
    expect(clientCall?.[0]?.where?.AND).toContainEqual({ isActive: false });
  });
});
