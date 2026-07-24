import { AdminAfiliadosController } from './admin-afiliados.controller';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';

const masterUser = { id: 'admin1', role: 'ADMIN', email: 'master@simintpay.com', tenantModule: { slug: 'master', name: 'Master' } };
const nonMasterAdmin = { id: 'admin2', role: 'ADMIN', email: 'sub@areaflix.com', tenantModule: { slug: 'areaflix', name: 'Areaflix' } };

function buildPrisma(overrides: any = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    affiliateCommission: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { commissionAmount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  } as any;
}

function invoke(method: string, prisma: any, ...args: any[]) {
  const ctx = { prisma } as any;
  return (AdminAfiliadosController.prototype as any)[method].apply(ctx, args);
}

describe('AdminAfiliadosController', () => {
  it('bloqueia quem não é master de verdade', async () => {
    const prisma = buildPrisma();
    prisma.user.findUnique.mockResolvedValue(nonMasterAdmin);

    await expect(invoke('list', prisma, nonMasterAdmin)).rejects.toThrow(ForbiddenException);
  });

  it('lista contas com isAffiliate=true', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn().mockResolvedValue(masterUser),
        findMany: jest.fn().mockResolvedValue([
          { id: 'aff1', name: 'Fulano', email: 'fulano@x.com', affiliateCommissionPercent: '10.00', affiliateCode: 'ABC123', _count: { referrals: 3 } },
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
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser) // assertMaster
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: null }), // target user
        update: jest.fn().mockResolvedValue({ id: 'u1', affiliateCode: 'GENCODE1' }),
      },
    });

    const res = await invoke('setAffiliate', prisma, 'u1', { isAffiliate: true, commissionPercent: 15 }, masterUser);

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
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u1', affiliateCode: 'JAEXISTE' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await invoke('setAffiliate', prisma, 'u1', { commissionPercent: 20 }, masterUser);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: expect.not.objectContaining({ affiliateCode: expect.anything() }),
    });
  });

  it('404 se o usuário-alvo não existe', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce(null),
      },
    });

    await expect(invoke('setAffiliate', prisma, 'ghost', { isAffiliate: true }, masterUser)).rejects.toThrow(NotFoundException);
  });

  it('override manual de indicado-por', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    const res = await invoke('setReferredBy', prisma, 'u2', { referredByUserId: 'aff1' }, masterUser);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u2' }, data: { referredByUserId: 'aff1' } });
    expect(res.success).toBe(true);
  });

  it('bloqueia se referredByUserId apontar pro próprio usuário', async () => {
    const prisma = buildPrisma({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce(masterUser)
          .mockResolvedValueOnce({ id: 'u2' }),
      },
    });

    await expect(
      invoke('setReferredBy', prisma, 'u2', { referredByUserId: 'u2' }, masterUser),
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
