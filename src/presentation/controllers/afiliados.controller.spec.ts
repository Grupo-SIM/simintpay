import { AfiliadosController } from './afiliados.controller';

function buildPrisma(user: any, commissions: any[] = []) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    affiliateCommission: {
      findMany: jest.fn().mockResolvedValue(commissions),
      aggregate: jest.fn().mockResolvedValue({
        _sum: { commissionAmount: commissions.filter((c) => c.status === 'CREDITED').reduce((s, c) => s + Number(c.commissionAmount), 0) || null },
      }),
    },
  } as any;
}

function invoke(prisma: any, authUser: any) {
  const ctx = { prisma } as any;
  return (AfiliadosController.prototype as any).me.call(ctx, authUser);
}

describe('AfiliadosController.me', () => {
  it('retorna vazio/zerado quando a conta não é afiliado', async () => {
    const prisma = buildPrisma({ id: 'u1', isAffiliate: false, affiliateCode: null, referrals: [] });
    const res = await invoke(prisma, { sub: 'u1' });
    expect(res.data.isAffiliate).toBe(false);
    expect(res.data.referrals).toEqual([]);
    expect(res.data.totalEarned).toBe(0);
  });

  it('retorna código, indicados e total ganho quando é afiliado', async () => {
    const prisma = buildPrisma(
      {
        id: 'u1', isAffiliate: true, affiliateCode: 'ABC123',
        referrals: [{ id: 'r1', name: 'Cliente 1', email: 'c1@x.com', createdAt: new Date('2026-07-01') }],
      },
      [{ id: 'c1', commissionAmount: '15.50', status: 'CREDITED', createdAt: new Date(), transactionId: 'tx1' }],
    );

    const res = await invoke(prisma, { sub: 'u1' });

    expect(res.data.isAffiliate).toBe(true);
    expect(res.data.affiliateCode).toBe('ABC123');
    expect(res.data.referrals).toHaveLength(1);
    expect(res.data.totalEarned).toBe(15.5);
  });
});
