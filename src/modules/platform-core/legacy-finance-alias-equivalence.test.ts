import { expect, test } from 'bun:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { InternalAtlasFinanceController } from '../../presentation/controllers/internal-atlas-finance.controller';
import { InternalBosqueFinanceController } from '../../presentation/controllers/internal-bosque-finance.controller';
import { InternalRenovadaFinanceController } from '../../presentation/controllers/internal-renovada-finance.controller';
import { InternalEbookFinanceController } from '../../presentation/controllers/internal-ebook-finance.controller';
import { InternalAreaflixFinanceController } from '../../presentation/controllers/internal-areaflix-finance.controller';
import { InternalPagatgFinanceController } from '../../presentation/controllers/internal-pagatg-finance.controller';
import { LEGACY_PLATFORM_CONTRACTS } from './legacy-platform-contracts';
const controllers = { atlas: InternalAtlasFinanceController, bosque: InternalBosqueFinanceController, renovada: InternalRenovadaFinanceController, ebook: InternalEbookFinanceController, areaflix: InternalAreaflixFinanceController, pagatg: InternalPagatgFinanceController };
for (const [tag, Controller] of Object.entries(controllers)) {
  const contracts = LEGACY_PLATFORM_CONTRACTS.filter(c => c.source.endsWith(`/internal-${tag}-finance.controller.ts`));
  const source = ts.createSourceFile(contracts[0].source, readFileSync(contracts[0].source, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(ts.isClassDeclaration)!;
  for (const contract of contracts) {
    test(`${contract.method} ${contract.path} delegates arguments, envelope and errors unchanged`, async () => {
      const handler = declaration.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText() === contract.handler)!;
      const args = handler.parameters.map((p, i) => p.name.getText() === 'body' ? { legacyField: 'preserved', amount: 12.34 } : `argument-${i}`);
      const calls: { method: string; args: unknown[] }[] = [];
      const response = { legacyEnvelope: true, amount: 12.34, meta: { totalPages: 1 } };
      let failure: Error | undefined;
      const service = new Proxy({}, { get: (_, method: string) => (...values: unknown[]) => { calls.push({ method, args: values }); if (failure) throw failure; return Promise.resolve(response); } });
      const controller = new (Controller as any)(service);
      expect(await controller[contract.handler](...args)).toBe(response);
      expect(calls).toEqual([{ method: contract.handler, args }]);
      failure = new Error('shared service rejection');
      await expect(Promise.resolve().then(() => controller[contract.handler](...args))).rejects.toBe(failure);
    });
  }
}
