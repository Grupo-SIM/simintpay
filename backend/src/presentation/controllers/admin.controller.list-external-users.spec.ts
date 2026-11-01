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
 * são Users role=USER sem plataforma externa e sem platform. Antes elas ficavam
 * invisíveis em GET /admin/usuarios ("Leads"). Agora aparecem como plataforma
 * virtual "simintpay".
 *
 * listExternalUsers usa Prisma e cache de pessoas externas; testes mantêm ambos
 * locais com dependências mockadas — sem subir o módulo Nest inteiro.
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
    platform: null,
  };

  // A query de clientes diretos é a única com um filtro { role: 'USER' } dentro do AND.
  const isClientQuery = (arg: any): boolean =>
    Array.isArray(arg?.where?.AND) &&
    arg.where.AND.some((c: any) => c && c.role === 'USER');

  const isModuleQuery = (arg: any): boolean =>
    Array.isArray(arg?.where?.AND) &&
    arg.where.AND.some(
      (c: any) =>
        Array.isArray(c?.OR) && c.OR.some((option: any) => option?.platform),
    );

  function makeMockPrisma(clientUsers: any[], moduleUsers: any[] = []) {
    return {
      platform: { findMany: jest.fn().mockResolvedValue([]) },
      externalPlatformUser: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest.fn().mockImplementation(async (arg: any) => {
          if (isClientQuery(arg)) {
            const flag = arg.where.AND.find(
              (c: any) => typeof c?.isSimintpayClient === 'boolean',
            );
            return flag
              ? clientUsers.filter(
                  (u) =>
                    (u.isSimintpayClient ?? false) === flag.isSimintpayClient,
                )
              : clientUsers;
          }
          if (!isModuleQuery(arg)) return [];
          const activeFilter = arg.where.AND.find(
            (c: any) => typeof c?.isActive === 'boolean',
          );
          return activeFilter
            ? moduleUsers.filter((u) => u.isActive === activeFilter.isActive)
            : moduleUsers;
        }),
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
    const ctx = Object.assign(Object.create(AdminController.prototype), {
      prisma,
      externalPlatformDb: { listAll: jest.fn().mockResolvedValue([]) },
    });
    return (AdminController.prototype as any).listExternalUsers.call(
      ctx,
      args.platform,
      args.page ?? '1',
      args.pageSize ?? '20',
      args.deleted,
      undefined,
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

  it('move conta de módulo inativa da aba ativa para contas inativas', async () => {
    const inactiveModuleUser = {
      ...directClient,
      id: 'revalida-inativa',
      email: 'inativa@revalida.com',
      isActive: false,
      platform: { tag: 'revalida' },
    };
    const prisma = makeMockPrisma([], [inactiveModuleUser]);

    const active = await invoke(prisma, { deleted: 'false' });
    const inactive = await invoke(prisma, { deleted: 'true' });

    expect(active.data).toHaveLength(0);
    expect(inactive.data).toEqual([
      expect.objectContaining({ id: 'revalida-inativa', isDeleted: true }),
    ]);
  });

  it('uses attributed snapshots for multiple explicit products, preserves shared wallet separately', async () => {
    const owner = {
      ...directClient,
      isActive: true,
      platform: null,
      wallet: { balance: 500, lockedBalance: 20 },
    };
    const products = ['ATLAS', 'BOSQUE'].map((tag) => ({
      id: tag,
      tag,
      ownerUserId: owner.id,
      acquirer: 'DOM',
      isActive: true,
    }));
    const prisma: any = makeMockPrisma([], [owner]);
    prisma.platform.findMany.mockResolvedValue(products);
    prisma.platform.findUnique = jest
      .fn()
      .mockImplementation(async ({ where }) => ({
        ...products.find((p) => p.id === where.id),
        owner: { isActive: true, isPurged: false },
      }));
    prisma.platform.count = jest.fn().mockResolvedValue(2);
    prisma.wallet = { findUnique: jest.fn().mockResolvedValue(owner.wallet) };
    prisma.withdrawRequest = {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockImplementation(async ({ where }) =>
        where.platform.in.includes('atlas')
          ? [
              { status: 'APPROVED', grossAmount: 10 },
              { status: 'PENDING', grossAmount: 20 },
            ]
          : [],
      ),
    };
    prisma.transaction.findMany.mockResolvedValue([
      {
        userId: owner.id,
        description: '[TENANT:ATLAS]',
        platformTag: 'ATLAS',
        netAmount: 100,
      },
      {
        userId: owner.id,
        description: '[TENANT:BOSQUE]',
        platformTag: 'BOSQUE',
        netAmount: 200,
      },
    ]);
    prisma.$transaction = async (fn: any) => fn(prisma);
    const result = await invoke(prisma);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      balance: 290,
      lockedBalance: 20,
      walletBalance: 500,
      walletScope: 'shared-owner',
    });
    expect(result.data[0].platformEntries.map((p: any) => p.platform)).toEqual([
      'atlas',
      'bosque',
    ]);
    expect(result.data[0].balanceAttribution).toHaveLength(2);
  });

  describe('contas marcadas como cliente Simintpay', () => {
    function invokeFull(
      prisma: any,
      args: {
        deleted?: string;
        purged?: string;
        page?: string;
        pageSize?: string;
      } = {},
    ) {
      return (AdminController.prototype as any).listExternalUsers.call(
        Object.assign(Object.create(AdminController.prototype), {
          prisma,
          externalPlatformDb: { listAll: jest.fn().mockResolvedValue([]) },
        }),
        undefined,
        args.page ?? '1',
        args.pageSize ?? '20',
        args.deleted,
        args.purged,
      );
    }

    it('default includes both classes and both activity states, but only approved accounts', async () => {
      const prisma = makeMockPrisma([directClient]);
      await invokeFull(prisma);
      const clientCall = prisma.user.findMany.mock.calls.find(([a]: any[]) =>
        isClientQuery(a),
      );
      expect(clientCall?.[0]?.where?.AND).toContainEqual({
        clientStatus: 'APPROVED',
      });
      expect(
        clientCall?.[0]?.where?.AND.some(
          (c: any) =>
            'isSimintpayClient' in c || 'isActive' in c || 'isCompany' in c,
        ),
      ).toBe(false);
      const [[externalCall]] = prisma.externalPlatformUser.findMany.mock.calls;
      expect(externalCall.where.isDeleted).toBeUndefined();
      expect(externalCall.where.AND).toEqual([
        {
          OR: [
            { userId: null },
            { user: { is: { clientStatus: 'APPROVED' } } },
            { user: { is: { ownedPlatforms: { some: {} } } } },
          ],
        },
      ]);
    });

    it('purged defaults to both classes', async () => {
      const prisma = makeMockPrisma([]);
      await invokeFull(prisma, { purged: 'true' });
      const clientCall = prisma.user.findMany.mock.calls.find(([a]: any[]) =>
        isClientQuery(a),
      );
      expect(clientCall?.[0].where.AND).toContainEqual({ isPurged: true });
      expect(
        clientCall?.[0].where.AND.some((c: any) => 'isSimintpayClient' in c),
      ).toBe(false);
    });

    it('aba de inativas não filtra pela marcação', async () => {
      const prisma = makeMockPrisma([directClient]);
      await invokeFull(prisma, { deleted: 'true' });

      const clientCall = prisma.user.findMany.mock.calls.find(([a]: any[]) =>
        isClientQuery(a),
      );
      expect(
        clientCall?.[0]?.where?.AND.some(
          (c: any) => c && 'isSimintpayClient' in c,
        ),
      ).toBe(false);
    });
  });
});
