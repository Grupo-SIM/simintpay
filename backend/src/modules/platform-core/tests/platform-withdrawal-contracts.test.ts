import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { initializePlatformTaxasCache } from '../../platform-taxas/platform-taxas.store';
import { platformWithdrawalQuote } from '../platform-withdrawal.adapter';
import { InternalAtlasFinanceService } from '../../unified-platform/finance/legacy-atlas-finance.service';
import { InternalAtlasFinanceController } from '../../../presentation/controllers/internal-atlas-finance.controller';
import { InternalBosqueFinanceService } from '../../unified-platform/finance/legacy-bosque-finance.service';
import { InternalBosqueFinanceController } from '../../../presentation/controllers/internal-bosque-finance.controller';
import { InternalRenovadaFinanceService } from '../../unified-platform/finance/legacy-renovada-finance.service';
import { InternalRenovadaFinanceController } from '../../../presentation/controllers/internal-renovada-finance.controller';
import { InternalEbookFinanceService } from '../../unified-platform/finance/legacy-ebook-finance.service';
import { InternalEbookFinanceController } from '../../../presentation/controllers/internal-ebook-finance.controller';
import { InternalPagatgFinanceService } from '../../unified-platform/finance/legacy-pagatg-finance.service';
import { InternalPagatgFinanceController } from '../../../presentation/controllers/internal-pagatg-finance.controller';
import { InternalAreaflixFinanceService } from '../../unified-platform/finance/legacy-areaflix-finance.service';
import { InternalAreaflixFinanceController } from '../../../presentation/controllers/internal-areaflix-finance.controller';
const definitions = [
  ['ATLAS', InternalAtlasFinanceService, InternalAtlasFinanceController, false],
  ['BOSQUE', InternalBosqueFinanceService, InternalBosqueFinanceController, true],
  ['RENOVADA', InternalRenovadaFinanceService, InternalRenovadaFinanceController, true],
  ['EBOOK', InternalEbookFinanceService, InternalEbookFinanceController, false],
  ['PAGATG', InternalPagatgFinanceService, InternalPagatgFinanceController, false],
  ['AREAFLIX', InternalAreaflixFinanceService, InternalAreaflixFinanceController, true],
] as const;
beforeEach(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => definitions.flatMap(([tag]) => [
  { tag, key: 'TAXA_SAQUE_FIXA', value: 3.5 }, { tag, key: 'TAXA_SAQUE_PERCENT', value: 0.02 }, { tag, key: 'SAQUE_MIN', value: 100 },
]) } } as any));
afterEach(async () => initializePlatformTaxasCache({ platformTaxaOverride: { findMany: async () => [] } } as any));
function fixture(tag: string, Service: any, Controller: any) {
  const context = { id: 'product', tag, ownerUserId: 'owner', acquirer: 'FRENDZ' as const };
  const platform = { ...context, isActive: true, owner: { isActive: true, isPurged: false } };
  const p: any = {
    platform: { findUnique: mock(async () => platform) },
    user: { findUnique: async () => ({ id: 'owner', isActive: true }), findMany: async () => [{ id: 'owner' }] },
    wallet: { findUnique: async () => ({ id: 'wallet', balance: new Prisma.Decimal(1000), lockedBalance: new Prisma.Decimal(10), version: 2 }), updateMany: mock(async () => ({ count: 1 })) },
    withdrawRequest: { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], create: mock(async ({ data }: any) => ({ id: 'withdrawal', ...data })) },
    transaction: { aggregate: async () => ({ _sum: { netAmount: 1000 } }), count: async () => 0 },
    balanceLog: { create: mock(async () => ({})) },
    $transaction: async (fn: any) => fn(p),
  };
  const finance = new PlatformFinanceService(p);
  const service = tag === 'EBOOK' || tag === 'PAGATG' ? new Service(p, {}, finance) : new Service(p, finance);
  return { p, platform, finance, controller: new Controller(service), context };
}
for (const [tag, Service, Controller, reserves] of definitions) {
  test(`${tag} withdrawal alias and canonical persist same amounts, fees and registered acquirer`, async () => {
    const a = fixture(tag, Service, Controller), b = fixture(tag, Service, Controller);
    const legacyAmount = 100;
    const netBasis = tag === 'EBOOK' || tag === 'PAGATG';
    const grossCents = netBasis ? 10550 : 10000;
    const alias = await a.controller.requestWithdraw({ cpf: '12345678901', userId: 'owner', amount: legacyAmount, pixKey: ' key ' });
    const canonical = await b.finance.requestWithdrawal(b.context, { amountCents: grossCents, pixKey: ' key ', idempotencyKey: 'request' });
    expect(alias).toMatchObject({ success: true, id: canonical.id });
    const old = a.p.withdrawRequest.create.mock.calls[0][0].data;
    const current = b.p.withdrawRequest.create.mock.calls[0][0].data;
    for (const key of ['userId', 'platform', 'pixKey', 'status', 'acquirer']) expect(old[key]).toEqual(current[key]);
    for (const key of ['amount', 'grossAmount', 'fee']) expect(new Prisma.Decimal(old[key]).equals(current[key])).toBe(true);
    expect(current.acquirer).toBe('FRENDZ');
    expect(canonical.grossAmountCents).toBe(grossCents);
    expect(canonical.amountCents + canonical.feeCents).toBe(grossCents);
    // Legacy no-reservation policies remain confined to inventoried aliases.
    expect(a.p.wallet.updateMany).toHaveBeenCalledTimes(reserves ? 1 : 0);
    expect(b.p.wallet.updateMany).toHaveBeenCalledTimes(1);
  });
  test(`${tag} alias blocks missing/inactive registered platform before financial writes`, async () => {
    const f = fixture(tag, Service, Controller);
    f.platform.isActive = false;
    await expect(f.controller.requestWithdraw({ cpf: '12345678901', userId: 'owner', amount: 100, pixKey: 'key' })).rejects.toThrow('alterado/inativo');
    expect(f.p.withdrawRequest.create).not.toHaveBeenCalled();
    expect(f.p.wallet.updateMany).not.toHaveBeenCalled();
    f.p.platform.findUnique.mockResolvedValue(null);
    await expect(f.controller.requestWithdraw({ cpf: '12345678901', userId: 'owner', amount: 100, pixKey: 'key' })).rejects.toThrow('Plataforma não cadastrada');
    expect(f.p.withdrawRequest.create).not.toHaveBeenCalled();
  });
}
test('merchant quote keeps gross basis even for products with net-priced owner withdrawals', () => {
  const quote = platformWithdrawalQuote('PAGATG', new Prisma.Decimal(100), true);
  expect(quote.amount.toString()).toBe('94.5');
  expect(quote.fee.toString()).toBe('5.5');
});
