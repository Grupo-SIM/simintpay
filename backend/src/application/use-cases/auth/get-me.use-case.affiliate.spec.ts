import { GetMeUseCase } from './get-me.use-case';

function build(user: any) {
  const users = { findById: jest.fn().mockResolvedValue(user) } as any;
  const wallets = {} as any;
  const prisma = {
    wallet: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ balance: '0', lockedBalance: '0' }),
    },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    withdrawRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { grossAmount: null } }),
    },
  } as any;
  return new GetMeUseCase(users, wallets, prisma);
}

describe('GetMeUseCase — campos de afiliado', () => {
  it('inclui isAffiliate e affiliateCode na resposta', async () => {
    const uc = build({
      id: 'u1',
      name: 'A',
      email: 'a@x.com',
      cpf: null,
      cnpj: null,
      role: 'USER',
      clientStatus: null,
      platform: null,
      domToken: null,
      createdAt: new Date(),
      isAffiliate: true,
      affiliateCode: 'ABC123',
    });

    const res = await uc.execute({ userId: 'u1' });

    expect(res.isAffiliate).toBe(true);
    expect(res.affiliateCode).toBe('ABC123');
  });

  it('isAffiliate=false e affiliateCode=null quando a conta não é afiliada', async () => {
    const uc = build({
      id: 'u1',
      name: 'A',
      email: 'a@x.com',
      cpf: null,
      cnpj: null,
      role: 'USER',
      clientStatus: null,
      platform: null,
      domToken: null,
      createdAt: new Date(),
      isAffiliate: false,
      affiliateCode: null,
    });

    const res = await uc.execute({ userId: 'u1' });

    expect(res.isAffiliate).toBe(false);
    expect(res.affiliateCode).toBeNull();
  });
});
