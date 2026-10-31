import { CreatePaymentLinkUseCase } from '../use-cases/payment-link/create-payment-link.use-case';
import { CreateSubscriptionLinkUseCase } from '../use-cases/subscription-link/create-subscription-link.use-case';
import { CreatePlanUseCase } from '../use-cases/plan/create-plan.use-case';
import { CreateBoletoUseCase } from '../use-cases/boleto/create-boleto.use-case';
import { PixPlanService } from '../use-cases/pix-plan/pix-plan.service';

jest.mock('../../modules/module.registry', () => ({
  getRegisteredPlatform: (tag: string) =>
    tag === 'SHOP' ? { tag: 'SHOP', ownerUserId: 'owner' } : null,
  getModuleDomToken: jest.fn(),
}));
jest.mock(
  '../../modules/platform-integrations/platform-integrations.store',
  () => ({ getPlatformIntegrationValue: () => 'shop-token' }),
);
const actor = { id: 'admin', email: 'admin@test.local', role: 'ADMIN' };
const owner = {
  id: 'owner',
  email: 'owner@test.local',
  role: 'USER',
  clientStatus: 'APPROVED',
};
const users = {
  findById: async (id: string) => (id === 'admin' ? actor : owner),
  findByEmail: async () => owner,
};
const saved = {
  id: 'product',
  code: 'CODE',
  title: 'Produto',
  amount: 20,
  price: 20,
  name: 'Produto',
  createdAt: new Date(),
  plataformas: ['SHOP'],
};
function dependencies() {
  const repo = {
    create: jest.fn().mockResolvedValue(saved),
    createPixCreditPlan: jest.fn().mockResolvedValue(saved),
    createPixPlanLinkCode: jest.fn().mockResolvedValue({ code: 'PX' }),
  };
  const gateway = {
    createPaymentLink: jest.fn().mockResolvedValue({ id: 'dom' }),
    createPlan: jest.fn().mockResolvedValue({ id: 'dom' }),
  };
  const prisma = {
    user: { findUnique: async ({ where }: any) => users.findById(where.id) },
  };
  return { repo, gateway, prisma };
}
describe('five products retain beneficiary separately from administrator actor', () => {
  const originalToken = process.env.DOM_TOKEN;
  beforeAll(() => {
    process.env.DOM_TOKEN = 'global-token';
  });
  afterAll(() => {
    if (originalToken === undefined) delete process.env.DOM_TOKEN;
    else process.env.DOM_TOKEN = originalToken;
  });
  it.each(
    ['payment', 'subscription', 'plan', 'boleto', 'pix'].flatMap((kind) => [
      { kind, platform: true },
      { kind, platform: false },
    ]),
  )(
    '$kind creation platform=$platform persists the resolved owner and actor',
    async ({ kind, platform }) => {
      const { repo, gateway, prisma } = dependencies();
      const target = {
        ownerUserId: 'owner',
        plataformas: platform ? ['SHOP'] : [],
      };
      if (kind === 'payment')
        await new CreatePaymentLinkUseCase(
          repo as any,
          gateway as any,
          users,
        ).execute({
          userId: actor.id,
          dto: { ...target, titulo: 'Produto', valor: 20 },
        });
      if (kind === 'subscription')
        await new CreateSubscriptionLinkUseCase(
          repo as any,
          users,
          gateway as any,
          prisma as any,
          {} as any,
        ).execute({
          userId: actor.id,
          dto: {
            ...target,
            titulo: 'Produto',
            valor: 20,
            frequencia: 'MENSAL',
          } as any,
        });
      if (kind === 'plan')
        await new CreatePlanUseCase(repo as any, gateway as any, users).execute(
          {
            userId: actor.id,
            dto: { ...target, nome: 'Produto', preco: 20, tipo: 'MENSAL' },
          },
        );
      if (kind === 'boleto')
        await new CreateBoletoUseCase(
          repo as any,
          gateway as any,
          users,
        ).execute({
          userId: actor.id,
          dto: { ...target, titulo: 'Produto', valor: 20 },
        });
      if (kind === 'pix')
        await new PixPlanService(
          repo as any,
          gateway as any,
          prisma as any,
        ).createPixCreditPlanFromPublicDto(actor.id, {
          ownerUserId: 'owner',
          tenantTag: platform ? 'SHOP' : undefined,
          price: 20,
          frequency_type: 'MONTH',
          description: 'Produto',
        } as any);
      const write = kind === 'pix' ? repo.createPixCreditPlan : repo.create;
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner', createdByUserId: 'admin' }),
      );
      if (kind !== 'pix')
        expect(
          (kind === 'plan' || kind === 'subscription'
            ? gateway.createPlan
            : gateway.createPaymentLink
          ).mock.calls[0][0],
        ).toBe(platform ? 'shop-token' : 'global-token');
    },
  );
  it('checks selected owner approval rather than approved administrator', async () => {
    const { repo, gateway } = dependencies();
    const pendingUsers = {
      ...users,
      findById: async (id: string) =>
        id === 'admin' ? actor : { ...owner, clientStatus: 'PENDING' },
    };
    await expect(
      new CreatePaymentLinkUseCase(
        repo as any,
        gateway as any,
        pendingUsers,
      ).execute({
        userId: actor.id,
        dto: { ownerUserId: owner.id, titulo: 'Produto', valor: 20 },
      }),
    ).rejects.toThrow('análise');
    expect(gateway.createPaymentLink).not.toHaveBeenCalled();
  });
});
