import { initializePlatformRegistryCache } from '../../../modules/module.registry';
import { initializePlatformIntegrationsCache } from '../../../modules/platform-integrations/platform-integrations.store';
import { initializePlatformTaxasCache } from '../../../modules/platform-taxas/platform-taxas.store';
beforeEach(async () => {
  const fixture = { platform: { findMany: async () => [{ tag: 'RENOVADA', ownerUserId: 'u1', customerInterestRates: {} }] }, platformIntegration: { findMany: async () => [{ platform: { tag: 'RENOVADA' }, key: 'DOM_TOKEN', url: 'assigned-token' }] }, platformTaxaOverride: { findMany: async () => [] } };
  await initializePlatformRegistryCache(fixture as never);
  await initializePlatformIntegrationsCache(fixture as never);
  await initializePlatformTaxasCache(fixture as never);
});
import { CreatePlanUseCase } from './create-plan.use-case';
import { ForbiddenException, BadRequestException } from '@nestjs/common';

const baseDto: any = { nome: 'P', preco: 20, tipo: 'MENSAL' };

function build(owner: any) {
  const plans = {
    create: jest.fn().mockResolvedValue({
      id: 'p1',
      name: 'P',
      description: null,
      price: 20,
      isActive: true,
      webhookUrl: null,
      redirectUrl: null,
      createdAt: new Date(),
    }),
  } as any;
  const gateway = {
    createPlan: jest.fn().mockResolvedValue({ id: 'dom1' }),
  } as any;
  const users = { findById: jest.fn().mockResolvedValue(owner) } as any;
  process.env.DOM_TOKEN = 'tok';
  return { uc: new CreatePlanUseCase(plans, gateway, users), plans, gateway };
}

describe('CreatePlanUseCase (cliente)', () => {
  it('bloqueia cliente PENDING', async () => {
    const { uc } = build({
      id: 'u1',
      email: 'v@v.com',
      clientStatus: 'PENDING',
    });
    await expect(uc.execute({ userId: 'u1', dto: baseDto })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('bloqueia valor < 14,99 para cliente APPROVED', async () => {
    const { uc } = build({
      id: 'u1',
      email: 'v@v.com',
      clientStatus: 'APPROVED',
    });
    await expect(
      uc.execute({ userId: 'u1', dto: { ...baseDto, preco: 10 } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cliente APPROVED preserva plataforma explicitamente atribuída', async () => {
    const { uc, plans } = build({
      id: 'u1',
      email: 'v@v.com',
      clientStatus: 'APPROVED',
    });
    await uc.execute({
      userId: 'u1',
      dto: { ...baseDto, plataformas: ['RENOVADA'] },
    });
    expect(plans.create).toHaveBeenCalledWith(
      expect.objectContaining({ plataformas: ['RENOVADA'] }),
    );
  });

  it('conta não-cliente mantém comportamento atual (usa plataforma enviada)', async () => {
    const { uc, plans } = build({
      id: 'u1',
      email: 'v@v.com',
      clientStatus: null,
    });
    await uc.execute({
      userId: 'u1',
      dto: { ...baseDto, plataformas: ['RENOVADA'] },
    });
    expect(plans.create).toHaveBeenCalledWith(
      expect.objectContaining({ plataformas: ['RENOVADA'] }),
    );
  });
});
