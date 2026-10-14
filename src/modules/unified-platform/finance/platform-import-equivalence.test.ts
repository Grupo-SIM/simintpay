import { beforeAll, expect, mock, test } from 'bun:test';
import { InternalPagatgFinanceService } from './legacy-pagatg-finance.service';
import { PlatformFinanceService } from './platform-finance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
beforeAll(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as any));
function fixture() {
  const prisma: any = {
    platform: { findUnique: async () => ({ isActive: true, ownerUserId: 'owner', acquirer: 'DOM', owner: { isActive: true } }) },
    user: { findUnique: async () => ({ isActive: true }), findMany: async () => [{ id: 'owner' }] },
    transaction: { findUnique: async () => null, create: mock(async ({ data }: any) => ({ id: 'entry', ...data })) },
    wallet: { upsert: mock(async () => ({})) },
    $transaction: async (f: any) => f(prisma),
  };
  const finance = new PlatformFinanceService(prisma);
  return { prisma, finance, alias: new InternalPagatgFinanceService(prisma, {} as any, finance) };
}
test('PAGATG alias reais and canonical cents produce equivalent ledger and credit', async () => {
  const old = fixture(), canonical = fixture();
  const alias = await old.alias.recordTransaction({ cpf: '12345678901', domPaymentId: 'invoice', amount: 12.34, netAmount: 12, planDescription: 'Plano', paymentMethod: 'PIX' });
  const result = await canonical.finance.importEntry({ id: 'platform', tag: 'PAGATG', ownerUserId: 'owner', acquirer: 'DOM' }, { referenceId: 'invoice', amountCents: 1234, netAmountCents: 1200, kind: 'payment', paymentMethod: 'PIX', description: 'Plano' });
  expect(alias).toEqual(result);
  const a = old.prisma.transaction.create.mock.calls[0][0].data;
  const b = canonical.prisma.transaction.create.mock.calls[0][0].data;
  for (const key of ['userId', 'domPaymentId', 'status', 'paymentMethod', 'acquirer']) expect(a[key]).toEqual(b[key]);
  for (const key of ['amount', 'netAmount', 'totalFee']) expect(a[key].toString()).toEqual(b[key].toString());
  expect(old.prisma.wallet.upsert.mock.calls[0][0].update.balance.increment.toString()).toEqual(canonical.prisma.wallet.upsert.mock.calls[0][0].update.balance.increment.toString());
});
test('plan mirror rejects global code owned by another product', async () => {
  const { prisma, finance } = fixture();
  prisma.plan = { findUnique: async () => ({ userId: 'owner', plataformas: ['OTHER'] }), update: mock(async () => ({})), create: mock(async () => ({})) };
  await expect(finance.mirrorPlan('PAGATG', 'owner', 'plan', { name: 'Plano', price: 10, type: 'MONTHLY' })).rejects.toThrow('Plano sem vínculo');
  expect(prisma.plan.update).not.toHaveBeenCalled();
});
