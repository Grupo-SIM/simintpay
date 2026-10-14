import { UpdatePlanUseCase } from './update-plan.use-case';
describe('Recurring plan client editing', () => {
 const plan = { id: 'owned', userId: 'owner', name: 'Old', code: 'stable', type: 'WEEKLY', price: 14.99, frequency: 2, repetitions: 12, retryDays: 10, createdAt: new Date(), plataformas: ['OTHER-LEGACY'], domPlanId: 'gateway-plan' };
 it('preserves recurrence, gateway ID, code and omitted platform links on name edit', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(plan), update: jest.fn().mockResolvedValue(plan) };
  const gateway = { createPlan: jest.fn() };
  const uc = new UpdatePlanUseCase(repo as never, gateway as never, {} as never);
  await uc.execute({ userId: 'owner', role: 'USER', id: 'owned', dto: { nome: 'Changed' } });
  expect(repo.findByIdForUser).toHaveBeenCalledWith({ id: 'owned', userId: 'owner' });
  expect(repo.update.mock.calls[0][1]).toMatchObject({ name: 'Changed', frequency: 2, repetitions: 12, retryDays: 10, domPlanId: 'gateway-plan' });
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('code');
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('plataformas');
  expect(gateway.createPlan).not.toHaveBeenCalled();
 });
 it('rejects forged ID before mutation', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(null), update: jest.fn() };
  const uc = new UpdatePlanUseCase(repo as never, {} as never, {} as never);
  await expect(uc.execute({ userId: 'attacker', role: 'USER', id: 'owned', dto: { nome: 'Changed' } })).rejects.toThrow('Plano não encontrado');
  expect(repo.update).not.toHaveBeenCalled();
 });
});
