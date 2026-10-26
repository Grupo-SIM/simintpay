import { recoverPlanRecurrence } from './plan-recurrence.helper';
describe('Legacy plan recurrence preservation', () => {
 beforeEach(() => { process.env.DOM_TOKEN = 'local-mocked-token'; });
 afterEach(() => { delete process.env.DOM_TOKEN; });
 const plan = { id: 'local', domPlanId: 'gateway-owned', plataformas: [], frequency: null, repetitions: null, retryDays: null };
 it('recovers exact interval, repetitions and retries from owned gateway ID', async () => {
  const gateway = { listPlans: jest.fn().mockResolvedValue([{ id: 'other', frequency: 99 }, { id: 'gateway-owned', frequency: 3, repetitions: 12, retry_days: 10 }]) };
  const repo = { update: jest.fn().mockResolvedValue({ ...plan, frequency: 3, repetitions: 12, retryDays: 10 }) };
  await recoverPlanRecurrence(plan as never, repo as never, gateway as never);
  expect(repo.update).toHaveBeenCalledWith('local', { frequency: 3, repetitions: 12, retryDays: 10 });
 });
 it('never guesses omitted settings or changes unrelated plan', async () => {
  const gateway = { listPlans: jest.fn().mockResolvedValue([{ id: 'gateway-owned', frequency: 3, repetitions: 12 }]) };
  const repo = { update: jest.fn() };
  await expect(recoverPlanRecurrence(plan as never, repo as never, gateway as never)).rejects.toThrow('configuração completa');
  expect(repo.update).not.toHaveBeenCalled();
 });
});
