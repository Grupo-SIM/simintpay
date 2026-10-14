import { expect, test } from 'bun:test';
import { AdminController } from '../../presentation/controllers/admin.controller';
import { PlatformAdministrationService } from './platform-administration.service';
const cases: [string, unknown[]][] = [
  ['getPlataformasSaldosResumo', []], ['listPlataformas', []], ['listPlataformaComunidades', ['BOSQUE']],
  ['getAtlasBreakdown', ['2026-09-01', '2026-09-30']],
  ['getPlataformaDistribuicaoMetodo', ['BOSQUE', '2026-09-01', '2026-09-30']],
  ['listPlataformaTransacoes', ['BOSQUE', '1', '20', 'COMPLETED', 'Buyer', '2026-09-01', '2026-09-30']],
  ['getPlataformaConsolidado', ['BOSQUE', '2026-09-01', '2026-09-30', 'PIX', false]],
];
for (const [method, args] of cases) {
  test(`${method} alias returns shared administration result without changing values`, async () => {
    const prototype = PlatformAdministrationService.prototype as any;
    const original = prototype[method];
    const response = { data: [{ amount: 12.34 }], meta: { total: 1 } };
    let received: unknown[] = [];
    prototype[method] = async (...values: unknown[]) => { received = values; return response; };
    try {
      const alias = Object.assign(Object.create(AdminController.prototype), { prisma: {}, paymentGateway: {}, platformReporting: {} });
      expect(await alias[method](...args)).toBe(response);
      expect(received).toEqual(args);
    } finally { prototype[method] = original; }
  });
}
