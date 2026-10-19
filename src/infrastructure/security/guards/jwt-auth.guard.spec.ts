import { JwtAuthGuard } from './jwt-auth.guard';
describe('Client product authorization', () => {
 const prisma = { user: { findUnique: jest.fn() } };
 const guard = new JwtAuthGuard(prisma as never);
 const authorize = (request: unknown) => (guard as any).authorizeClient(request);
 const request = { user: { sub: 'client', role: 'USER' }, url: '/planos/id', method: 'POST', body: { preco: 14.99 } };
 beforeEach(() => { prisma.user.findUnique.mockResolvedValue({ clientStatus: 'APPROVED' }); });
 it('allows approved client to edit available fields', async () => { await expect(authorize(request)).resolves.toBeUndefined(); });
 it.each(['PENDING', 'REJECTED', null])('blocks %s accounts', async clientStatus => {
  prisma.user.findUnique.mockResolvedValue({ clientStatus });
  await expect(authorize(request)).rejects.toThrow('Conta precisa estar aprovada');
 });
 it.each(['userId', 'platformFee1x', 'platformFee12x', 'cashbackFee', 'platformFee', 'platformTag', 'communityId', 'code', 'tenantTag'])('blocks protected %s', async field => {
  await expect(authorize({ ...request, body: { [field]: 'tampered' } })).rejects.toThrow('não podem ser alterados');
 });
 it.each(['/admin/clientes', '/communities', '/plataformas', '/payments/admin/pix-plan-access', '/payments/plan-access/decrement-all'])('blocks administrative URL %s', async url => {
  await expect(authorize({ ...request, url })).rejects.toThrow('Área administrativa restrita');
 });
 it.each([['GET', '/platforms'], ['POST', '/platforms'], ['PATCH', '/platforms/SHOP'], ['GET', '/platforms/SHOP/financial-policy'], ['PATCH', '/platforms/SHOP/financial-policy'], ['POST', '/platforms/SHOP/financial-policy/simulation'], ['GET', '/platforms/SHOP/integrations']])('delegates owned platform access to service for %s %s', async (method, url) => {
  await expect(authorize({ ...request, method, url })).resolves.toBeUndefined();
 });
 it('rejects clearing administrative links and introducing PIX routing markers', async () => {
  await expect(authorize({ ...request, body: { plataformas: [] } })).rejects.toThrow('não podem ser alterados');
  await expect(authorize({ ...request, url: '/payments/pix-plan', body: { description: 'New [TENANT:OTHER]' } })).rejects.toThrow('não podem ser informados');
 });
 it('allows revoked client to remove its push device before logout', async () => {
  prisma.user.findUnique.mockResolvedValue({ clientStatus: 'REJECTED' });
  await expect(authorize({ ...request, method: 'DELETE', url: '/notifications/push/subscriptions' })).resolves.toBeUndefined();
 });
 it.each(['/admin/plataformas/cliente/dashboard', '/admin/cobrancas/minhas', '/admin/plataformas/minhas-taxas'])('preserves authenticated self-service %s', async url => {
  await expect(authorize({ ...request, url, method: 'GET' })).resolves.toBeUndefined();
  await expect(authorize({ ...request, url, method: 'POST' })).rejects.toThrow('Área administrativa restrita');
 });
 it('rejects too low price and preserves administrative behavior', async () => {
  await expect(authorize({ ...request, body: { preco: 14.98 } })).rejects.toThrow('Valor mínimo');
  await expect(authorize({ ...request, user: { sub: 'admin', role: 'ADMIN' } })).resolves.toBeUndefined();
 });
});
