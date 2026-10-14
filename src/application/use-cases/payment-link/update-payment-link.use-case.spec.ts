import { UpdatePaymentLinkUseCase } from './update-payment-link.use-case';
import { GetPaymentLinkUseCase } from './get-payment-link.use-case';
describe('Client payment link edit', () => {
 const link = { id: 'link', title: 'Title', amount: 14.99, code: 'stable-code', aceitaCartao: false, aceitaPix: true, aceitaDebito: false, createdAt: new Date(), maxInstallments: 1, isActive: true, isStandalone: true, plataformas: [], domPaymentLinkId: null };
 it('hydrates actual stored payment methods', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(link) };
  const uc = new GetPaymentLinkUseCase(repo as never);
  expect(await uc.execute({ userId: 'owner', id: 'link' })).toMatchObject({ data: { aceitaCartao: false, aceitaPix: true, aceitaDebito: false, codigo: 'stable-code' } });
 });
 it('changes requested methods and preserves omitted fields and public code', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(link), update: jest.fn().mockResolvedValue(link) };
  const uc = new UpdatePaymentLinkUseCase(repo as never, {} as never);
  await uc.execute({ userId: 'owner', id: 'link', dto: { aceitaCartao: true, aceitaPix: false } });
  expect(repo.findByIdForUser).toHaveBeenCalledWith({ id: 'link', userId: 'owner' });
  expect(repo.update).toHaveBeenCalledWith('link', expect.objectContaining({ aceitaCartao: true, aceitaPix: false, aceitaDebito: false }));
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('code');
  expect(repo.update.mock.calls[0][1]).not.toHaveProperty('userId');
 });
 it('rejects another owner ID before changing data', async () => {
  const repo = { findByIdForUser: jest.fn().mockResolvedValue(null), update: jest.fn() };
  const uc = new UpdatePaymentLinkUseCase(repo as never, {} as never);
  await expect(uc.execute({ userId: 'attacker', id: 'link', dto: { titulo: 'hacked' } })).rejects.toThrow('Link não encontrado');
  expect(repo.update).not.toHaveBeenCalled();
 });
});
