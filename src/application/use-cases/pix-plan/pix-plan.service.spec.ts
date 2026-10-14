import { PixPlanService } from './pix-plan.service';
describe('PIX plan client editing', () => {
 it('updates only requested fields without touching codes or administrative links', async () => {
  const plan = { id: 'owned', userId: 'owner', tenantTag: 'LEGACY', description: 'Old' };
  const repo = { findPixCreditPlanById: jest.fn().mockResolvedValue(plan) };
  const prisma = { pixCreditPlan: { update: jest.fn().mockResolvedValue(plan) } };
  const service = new PixPlanService(repo as never, {} as never, prisma as never);
  await service.updatePixCreditPlan('owner', 'owned', { description: 'Changed' }, 'USER');
  expect(prisma.pixCreditPlan.update).toHaveBeenCalledWith({ where: { id: 'owned' }, data: { description: 'Changed' } });
 });
 it('rejects forged ID before mutation', async () => {
  const repo = { findPixCreditPlanById: jest.fn().mockResolvedValue({ userId: 'owner' }) };
  const prisma = { pixCreditPlan: { update: jest.fn() } };
  const service = new PixPlanService(repo as never, {} as never, prisma as never);
  await expect(service.updatePixCreditPlan('attacker', 'owned', { price: 20 }, 'USER')).rejects.toThrow('não pertence');
  expect(prisma.pixCreditPlan.update).not.toHaveBeenCalled();
 });
});
