jest.mock(
  '../../modules/platform-integrations/platform-integrations.store',
  () => ({
    getPlatformIntegrationValue: () => 'http://127.0.0.1/fixture',
  }),
);

import { AdminAfiliadosController } from './admin-afiliados.controller';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

const masterUser = {
  id: 'admin1',
  role: 'ADMIN',
  email: 'master@simintpay.com',
  platform: { tag: 'master', name: 'Master' },
};
const nonMasterAdmin = {
  id: 'admin2',
  role: 'ADMIN',
  email: 'sub@areaflix.com',
  platform: { tag: 'areaflix', name: 'Areaflix' },
};

function buildPrisma(overrides: any = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    affiliateCommission: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { commissionAmount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

function invoke(method: string, prisma: any, ...args: any[]) {
  const ctx = {
    prisma,
    fetchExternalAffiliates: jest.fn().mockResolvedValue([]),
  } as any;
  return (AdminAfiliadosController.prototype as any)[method].apply(ctx, args);
}

describe('AdminAfiliadosController', () => {
  it('bloqueia quem não é master de verdade', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(nonMasterAdmin);

    await expect(invoke('list', prisma, nonMasterAdmin)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lista contas com isAffiliate=true', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue(masterUser),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'aff1',
            name: 'Fulano',
            email: 'fulano@x.com',
            affiliateCommissionPercent: '10.00',
            affiliateCode: 'ABC123',
            _count: { referrals: 3 },
          },
        ]),
      },
    });

    const res = await invoke('list', prisma, masterUser);

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({ id: 'aff1', totalReferrals: 3 });
  });

  it('ativa afiliado e gera affiliateCode quando ainda não tem', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(masterUser) // assertMaster
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: null }), // target user
        update: jest
          .fn()
          .mockResolvedValue({ id: 'u1', affiliateCode: 'GENCODE1' }),
      },
    });

    const res = await invoke(
      'setAffiliate',
      prisma,
      'u1',
      { isAffiliate: true, commissionPercent: 15 },
      masterUser,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.objectContaining({
        isAffiliate: true,
        affiliateCommissionPercent: 15,
        affiliateCode: expect.any(String),
      }),
    });
    expect(res.success).toBe(true);
  });

  it('mantém affiliateCode existente ao só atualizar a %', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: 'JAEXISTE' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await invoke(
      'setAffiliate',
      prisma,
      'u1',
      { commissionPercent: 20 },
      masterUser,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.not.objectContaining({ affiliateCode: expect.anything() }),
    });
  });

  it('404 se o usuário-alvo não existe', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce(null),
      },
    });

    await expect(
      invoke(
        'setAffiliate',
        prisma,
        'ghost',
        { isAffiliate: true },
        masterUser,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('override manual de indicado-por', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    const res = await invoke(
      'setReferredBy',
      prisma,
      'u2',
      { referredByUserId: 'aff1' },
      masterUser,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { referredByUserId: 'aff1' },
    });
    expect(res.success).toBe(true);
  });

  it('bloqueia se referredByUserId apontar pro próprio usuário', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
      },
    });

    await expect(
      invoke(
        'setReferredBy',
        prisma,
        'u2',
        { referredByUserId: 'u2' },
        masterUser,
      ),
    ).rejects.toThrow(ConflictException);
  });

  describe('search (buscar)', () => {
    it('inclui referredByUserId e referredBy no select, para não zerar vínculo existente ao editar', async () => {
      const prisma = buildPrisma({
        user: {
          findUnique: jest.fn().mockResolvedValue(masterUser),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'u3',
              name: 'Ciclano',
              email: 'ciclano@x.com',
              isAffiliate: false,
              referredByUserId: 'aff1',
              referredBy: { id: 'aff1', name: 'Fulano', email: 'fulano@x.com' },
            },
          ]),
        },
      });

      const res = await invoke('search', prisma, 'ciclano', masterUser);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            referredByUserId: true,
            referredBy: { select: { id: true, name: true, email: true } },
          }),
        }),
      );

      expect(res.data[0]).toMatchObject({
        id: 'u3',
        referredByUserId: 'aff1',
        referredBy: { id: 'aff1', name: 'Fulano', email: 'fulano@x.com' },
      });
    });
  });
});

describe('affiliate referral purchases', () => {
  it('preserves generated commissions and restricts gross/purchases to selected affiliate referrals', async () => {
    const prisma = buildPrisma({
      transaction: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sale',
            userId: 'referral',
            amount: '100.00',
            description: 'Plan',
            paymentMethod: 'PIX',
            createdAt: new Date(0),
          },
        ]),
      },
    });
    prisma.user.findUnique
      .mockResolvedValueOnce(masterUser)
      .mockResolvedValueOnce({
        id: 'affiliate',
        name: 'Affiliate',
        email: 'affiliate@example.test',
        referrals: [
          { id: 'referral', name: 'Buyer', email: 'buyer@example.test' },
          { id: 'empty', name: 'Empty', email: 'empty@example.test' },
        ],
      });
    prisma.affiliateCommission.findMany.mockResolvedValue([
      {
        referredUserId: 'referral',
        transactionId: 'sale',
        commissionAmount: '4.00',
      },
    ]);
    const result = await invoke(
      'referrals',
      prisma,
      'affiliate',
      'SIMINTPAY',
      masterUser,
    );
    expect(prisma.affiliateCommission.findMany.mock.calls[0][0].where).toEqual({
      affiliateUserId: 'affiliate',
      status: 'CREDITED',
    });
    expect(prisma.transaction.findMany.mock.calls[0][0].where).toEqual({
      userId: { in: ['referral', 'empty'] },
      status: 'COMPLETED',
    });
    expect(result.data.referrals[0]).toMatchObject({
      generated: 4,
      grossTotal: 100,
      purchases: [{ title: 'Plan', grossAmount: 100, commissionAmount: 4 }],
    });
    expect(result.data.referrals[1]).toMatchObject({
      generated: 0,
      grossTotal: 0,
      purchases: [],
    });
  });
  it('external missing documents never infer a beneficiary from remote id or email', async () => {
    const prisma = buildPrisma({
      externalPlatformUser: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    });
    prisma.user.findUnique.mockResolvedValue(masterUser);
    const previous = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          affiliate: {
            id: 'same-local-id',
            email: 'same@example.test',
            name: 'Remote',
          },
          referrals: [],
        },
      }),
    });
    try {
      const result = await invoke(
        'referrals',
        prisma,
        'same-local-id',
        'EBOOK',
        masterUser,
      );
      expect(result.data.affiliate.wallet.balance).toBeNull();
      expect(result.data.affiliate.wallet.balanceStatus).toBe('unavailable');
      expect(prisma.externalPlatformUser.findMany).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    } finally {
      global.fetch = previous;
    }
  });

  it.each(['123.456.789-01', '12.345.678/0001-90'])(
    'normalizes document %s and batches only persisted beneficiaries',
    async (document) => {
      const normalized = document.replace(/\D/g, '');
      const prisma = buildPrisma({
        externalPlatformUser: {
          findMany: jest.fn().mockResolvedValue([
            {
              cpf: normalized.length === 11 ? normalized : null,
              cnpj: normalized.length === 14 ? normalized : null,
              userId: 'beneficiary',
              platform: 'EBOOKSIM',
            },
          ]),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      });
      prisma.user.findUnique.mockResolvedValue(masterUser);
      const previous = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            affiliate: { id: 'remote', cpf: document, name: 'Remote' },
            referrals: [
              { id: 'another-remote', cpf: document, name: 'Same beneficiary' },
            ],
          },
        }),
      });
      try {
        await invoke('referrals', prisma, 'remote', 'EBOOK', masterUser);
        expect(prisma.externalPlatformUser.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              OR: [
                { cpf: { in: [normalized] } },
                { cnpj: { in: [normalized] } },
              ],
            },
          }),
        );
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.user.findMany).not.toHaveBeenCalled();
      } finally {
        global.fetch = previous;
      }
    },
  );

  it('conflicting persisted document links remain unavailable', async () => {
    const prisma = buildPrisma({
      externalPlatformUser: {
        findMany: jest.fn().mockResolvedValue([
          { cpf: '12345678901', cnpj: null, userId: 'one', platform: 'EBOOK' },
          {
            cpf: '12345678901',
            cnpj: null,
            userId: 'two',
            platform: 'EBOOKSIM',
          },
        ]),
      },
      $queryRaw: jest.fn(),
    });
    prisma.user.findUnique.mockResolvedValue(masterUser);
    const previous = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          affiliate: { id: 'remote', cpf: '123.456.789-01', name: 'Remote' },
          referrals: [],
        },
      }),
    });
    try {
      const result = await invoke(
        'referrals',
        prisma,
        'remote',
        'EBOOK',
        masterUser,
      );
      expect(result.data.affiliate.wallet.balance).toBeNull();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    } finally {
      global.fetch = previous;
    }
  });

  it('no referrals never becomes an unscoped transaction query', async () => {
    const prisma = buildPrisma({ transaction: { findMany: jest.fn() } });
    prisma.user.findUnique
      .mockResolvedValueOnce(masterUser)
      .mockResolvedValueOnce({
        id: 'affiliate',
        name: 'Affiliate',
        email: 'affiliate@example.test',
        referrals: [],
      });
    expect(
      (await invoke('referrals', prisma, 'affiliate', 'SIMINTPAY', masterUser))
        .data.referrals,
    ).toEqual([]);
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });
});
