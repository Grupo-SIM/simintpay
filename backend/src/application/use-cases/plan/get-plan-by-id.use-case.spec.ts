import { GetPlanByIdUseCase } from './get-plan-by-id.use-case';
import { PlanType } from '@prisma/client';
describe('Client plan edit hydration', () => {
 it('hydrates weekly plan frequency accurately and isolates owner lookup', async () => {
  const plan = { id: 'plan', name: 'Weekly', type: PlanType.WEEKLY, price: 14.99, frequency: 2, repetitions: 1, retryDays: 10, createdAt: new Date() };
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(plan) };
  const uc = new GetPlanByIdUseCase(repo as never, {} as never);
  expect(await uc.execute({ userId: 'owner', role: 'USER', id: 'plan' })).toMatchObject({ data: { tipo: 'SEMANAL', frequencia: 2 } });
  expect(repo.findByIdForUser).toHaveBeenCalledWith({ id: 'plan', userId: 'owner' });
 });
});
