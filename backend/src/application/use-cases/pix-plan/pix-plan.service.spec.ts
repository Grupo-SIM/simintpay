import { PixPlanService } from './pix-plan.service';

describe('Client PIX plan editing', () => {
  const existing = { id: 'owned', userId: 'owner', description: 'Old', price: 29.99, tenantTag: 'LEGACY', webhookUrl: 'preserved-hook', redirectUrl: 'preserved-return' };
  const setup = (plan: typeof existing | null = existing) => {
    const repo = { findPixCreditPlanById: jest.fn().mockResolvedValue(plan) };
    const prisma = { pixCreditPlan: { update: jest.fn().mockResolvedValue(existing) } };
    const service = Object.assign(Object.create(PixPlanService.prototype), { repo, prisma }) as PixPlanService;
    return { service, repo, prisma };
  };
  it('updates only editable fields and keeps links, metadata and ownership', async () => {
    const { service, repo, prisma } = setup();
    await service.updatePixCreditPlan('owner', 'owned', { description: 'New', price: 49.99, frequency_type: 'QUARTER' }, 'USER');
    expect(repo.findPixCreditPlanById).toHaveBeenCalledWith('owned');
    expect(prisma.pixCreditPlan.update).toHaveBeenCalledWith({ where: { id: 'owned' }, data: { description: 'New', price: 49.99, type: 'TRIMESTRAL' } });
  });
  it('preserves original routing metadata and rejects replacement markers', async () => {
    const { service, prisma } = setup({ ...existing, description: 'Old [TENANT:LEGACY] [CPF:12345678901]' });
    await service.updatePixCreditPlan('owner', 'owned', { description: 'New' }, 'USER');
    expect(prisma.pixCreditPlan.update.mock.calls[0][0].data.description).toBe('New [TENANT:LEGACY] [CPF:12345678901]');
    prisma.pixCreditPlan.update.mockClear();
    await expect(service.updatePixCreditPlan('owner', 'owned', { description: 'New [TENANT:OTHER]' }, 'USER')).rejects.toThrow('não podem ser alterados');
    expect(prisma.pixCreditPlan.update).not.toHaveBeenCalled();
  });
  it('rejects another owner before mutation', async () => {
    const { service, prisma } = setup();
    await expect(service.updatePixCreditPlan('attacker', 'owned', { price: 49.99 }, 'USER')).rejects.toThrow('não pertence');
    expect(prisma.pixCreditPlan.update).not.toHaveBeenCalled();
  });
  it('rejects nonexistent IDs and retains admin access', async () => {
    const missing = setup(null);
    await expect(missing.service.updatePixCreditPlan('owner', 'missing', { price: 49.99 }, 'USER')).rejects.toThrow('não encontrado');
    expect(missing.prisma.pixCreditPlan.update).not.toHaveBeenCalled();
    const admin = setup();
    await expect(admin.service.updatePixCreditPlan('admin', 'owned', { price: 49.99 }, 'ADMIN')).resolves.toBeDefined();
  });
});
