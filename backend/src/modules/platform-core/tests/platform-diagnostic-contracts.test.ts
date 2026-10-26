import { expect, test } from 'bun:test';
import { BosquePaymentController } from '../../bosque/controllers/bosque-payment.controller';
import { RenovadaPaymentController } from '../../renovada/controllers/renovada-payment.controller';
import { AtlasDashboardController } from '../../atlas/controllers/atlas-dashboard.controller';
import { RevalidaDashboardController } from '../../revalida/controllers/revalida-dashboard.controller';

for (const [name, Controller] of [['Bosque', BosquePaymentController], ['Renovada', RenovadaPaymentController]] as const) test(`${name} diagnostic preserves static response without database or gateway`, async () => {
  const result = await new Controller(undefined as never, undefined as never).test();
  expect(result).toMatchObject({ message: `[${name.toUpperCase()}] Payments API working`, module: name, environment: process.env.NODE_ENV || 'development' });
  expect(Number.isFinite(Date.parse(result.timestamp))).toBe(true);
});
for (const [name, Controller] of [['Atlas', AtlasDashboardController], ['Revalida', RevalidaDashboardController]] as const) test(`${name} setup remains disabled, never creates platform or technical user`, async () => {
  try { await new Controller(undefined as never, undefined as never, undefined as never).setup(); throw new Error('setup must fail'); }
  catch (error: any) { expect(error.getStatus()).toBe(410); expect(error.message).toContain('admin'); }
});
