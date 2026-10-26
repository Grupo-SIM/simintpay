import { UpdateBoletoUseCase } from './update-boleto.use-case';
describe('boleto client editing', () => {
 const existing = { id: 'owned', userId: 'owner', code: 'stable', title: 'Old', name: 'Old', amount: 14.99, frequencyType: 'WEEKLY', isActive: true, plataformas: ['OTHER-LEGACY'], domPaymentLinkId: null, domPlanId: null, createdAt: new Date(), platformTag: 'OTHER-LEGACY', platformFee: 9, emailBody: 'untouched' };
 it('uses owner scoped lookup and preserves code, fees and platform links', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(existing), update: jest.fn().mockResolvedValue(existing) };
  const uc = new UpdateBoletoUseCase(repo as never, {} as never);
  await uc.execute({ userId: 'owner', role: 'USER', id: 'owned', dto: { titulo: 'Updated' } });
  expect(repo.findByIdForUser).toHaveBeenCalledWith({ id: 'owned', userId: 'owner' });
  expect(repo.update.mock.calls[0][1]).toMatchObject({ title: 'Updated' });
  for (const field of ['userId', 'code', 'platformFee', 'emailBody', 'plataformas']) expect(repo.update.mock.calls[0][1]).not.toHaveProperty(field);
 });
 it('rejects forged ID before mutation', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(null), update: jest.fn() };
  const uc = new UpdateBoletoUseCase(repo as never, {} as never);
  await expect(uc.execute({ userId: 'attacker', role: 'USER', id: 'owned', dto: { titulo: 'Updated' } })).rejects.toThrow();
  expect(repo.update).not.toHaveBeenCalled();
 });
});
