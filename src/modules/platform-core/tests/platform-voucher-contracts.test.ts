import { expect, mock, test } from 'bun:test';
import { VoucherService } from '../../../application/use-cases/voucher/voucher.service';
import { InternalPagatgFinanceService } from '../../unified-platform/finance/legacy-pagatg-finance.service';
import { InternalPagatgFinanceController } from '../../../presentation/controllers/internal-pagatg-finance.controller';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { PlatformVoucherCapabilitiesService } from '../platform-voucher-capabilities.service';

const context = { id: 'p', tag: 'PAGATG', ownerUserId: 'owner', acquirer: 'DOM' as const };
function fixture() {
  let row: any;
  const matches = (where: any) => row && Object.entries(where).every(([key, value]: any) => key === 'allowedChannels' ? row.allowedChannels.includes(value.has) : row[key] === value);
  const p: any = {
    user: { findMany: async () => [{ id: 'owner' }] },
    voucher: {
      findMany: async ({ where }: any) => matches(where) ? [row] : [],
      findFirst: async ({ where }: any) => matches(where) ? row : null,
      findUnique: async ({ where }: any) => matches(where) ? row : null,
      create: mock(async ({ data }: any) => row = { id: 'voucher', usageCount: 0, isActive: true, ...data }),
      update: mock(async ({ data }: any) => row = { ...row, ...data }),
      delete: mock(async () => { row = undefined; }),
    },
  };
  const vouchers = new VoucherService(p);
  const finance = new PlatformFinanceService(p);
  const alias = new InternalPagatgFinanceController(new InternalPagatgFinanceService(p, vouchers, finance));
  const canonical = new PlatformVoucherCapabilitiesService(p, { resolve: async () => context } as any, { get: () => vouchers } as any);
  const seed = async () => canonical.create(context, { code: 'off', discountType: 'FIXED', discountAmountCents: 1234 });
  return { p, alias, canonical, seed, row: () => row };
}
const identity = { cpf: '12345678901' };

test('Pagatg voucher creation aliases reais and canonical cents persist identical discount contract', async () => {
  const a = fixture(), b = fixture();
  const old = await a.alias.createVoucher({ ...identity, dto: { code: 'off', discountType: 'FIXED', discountValue: 12.34 } });
  const current = await b.seed();
  expect(a.p.voucher.create.mock.calls).toEqual(b.p.voucher.create.mock.calls);
  expect(current).toMatchObject({ id: old.id, code: 'OFF', discountAmountCents: 1234 });
});
test('Pagatg voucher listing translates stored units and keeps product selection explicit', async () => {
  const f = fixture(); await f.seed();
  const old = await f.alias.listVouchers(identity.cpf);
  const current = await f.canonical.list(context);
  expect(current.data[0].discountAmountCents).toBe(old.data[0].discountValue * 100);
  expect(current.data[0].code).toBe(old.data[0].code);
});
test('Pagatg voucher validation uses same discount calculation and caps at order value', async () => {
  const f = fixture(); await f.seed();
  for (const amount of [100.29, 5]) {
    const old = await f.alias.validateVoucher({ ...identity, dto: { code: 'OFF', amount, channel: 'PAGATG' } });
    const current = await f.canonical.validate(context, { code: 'OFF', amountCents: Math.round(amount * 100) });
    expect(current).toMatchObject({ valid: old.valid, code: old.code, discountAmountCents: Math.round(old.discountAmount * 100), finalAmountCents: Math.round(old.finalAmount * 100) });
  }
});
test('Pagatg voucher update alias percentage and canonical decimal rate persist same fields', async () => {
  const a = fixture(), b = fixture(); await a.seed(); await b.seed();
  const old = await a.alias.updateVoucher('voucher', { ...identity, dto: { discountType: 'PERCENTAGE', discountValue: 15, isActive: false, allowedChannels: ['PAGATG'] } });
  const current = await b.canonical.update(context, 'voucher', { discountType: 'PERCENTAGE', discountRate: 0.15, isActive: false });
  expect(a.p.voucher.update.mock.calls).toEqual(b.p.voucher.update.mock.calls);
  expect(current).toMatchObject({ discountRate: old.discountValue / 100, isActive: false });
  expect(current).not.toHaveProperty('discountValue');
});
test('Pagatg voucher deletion aliases and canonical use same ownership-protected operation', async () => {
  const a = fixture(), b = fixture(); await a.seed(); await b.seed();
  expect(await a.alias.deleteVoucher('voucher', identity)).toEqual(await b.canonical.delete(context, 'voucher'));
  expect(a.p.voucher.delete.mock.calls).toEqual(b.p.voucher.delete.mock.calls);
  expect(a.row()).toBeUndefined(); expect(b.row()).toBeUndefined();
});
test('canonical voucher update rejects foreign IDs, ambiguous units and identity overrides', async () => {
  const f = fixture(); await f.seed();
  await expect(f.canonical.update(context, 'foreign', { isActive: false })).rejects.toThrow('Voucher não encontrado');
  for (const body of [{ discountRate: 0.1 }, { discountAmountCents: 1.2 }, { discountType: 'PERCENTAGE' }, { isActive: false, userId: 'foreign' }]) {
    await expect(f.canonical.update(context, 'voucher', body as any)).rejects.toThrow();
  }
  expect(f.p.voucher.update).not.toHaveBeenCalled();
});
