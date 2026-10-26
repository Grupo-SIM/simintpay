import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { LEGACY_PLATFORM_CONTRACTS, ORIGINAL_LEGACY_PLATFORM_CONTRACTS, RETIRED_LEGACY_PLATFORM_CONTRACTS } from './legacy-platform-contracts';

const sources = new Map<string, ts.SourceFile>();
function decorators(node: ts.Node) { return ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []; }
function call(node: ts.Node, name: string) {
  return decorators(node).map(d => d.expression).find((e): e is ts.CallExpression => ts.isCallExpression(e) && e.expression.getText() === name);
}
function literal(node: ts.Node | undefined) { return node && (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : undefined; }
for (const contract of LEGACY_PLATFORM_CONTRACTS) {
  test(`${contract.method} ${contract.path} preserves declared alias contract`, () => {
    let source = sources.get(contract.source);
    if (!source) {
      source = ts.createSourceFile(contract.source, readFileSync(contract.source, 'utf8'), ts.ScriptTarget.Latest, true);
      sources.set(contract.source, source);
    }
    const controller = source.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && !!call(s, 'Controller'))!;
    expect(controller).toBeDefined();
    const handler = controller.members.find((s): s is ts.MethodDeclaration => ts.isMethodDeclaration(s) && s.name.getText() === contract.handler)!;
    expect(handler).toBeDefined();
    const name = contract.sse ? 'Sse' : ({ GET: 'Get', POST: 'Post', PUT: 'Put', DELETE: 'Delete', PATCH: 'Patch' } as const)[contract.method];
    const route = call(handler, name)!;
    expect(route).toBeDefined();
    const prefix = literal(call(controller, 'Controller')?.arguments[0]) ?? '';
    const suffix = literal(route.arguments[0]) ?? '';
    expect(`/${[prefix, suffix].map(s => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`).toBe(contract.path);
    const status = Number(literal(call(handler, 'HttpCode')?.arguments[0]) ?? (contract.method === 'POST' ? '201' : '200'));
    if (!contract.response.startsWith('410')) expect(status).toBe(Number(contract.response.split(' ')[0]));
    if (contract.auth === 'anônimo') {
      // Public legacy access is intentional; class-level guards would change old consumers.
      if (!call(handler, 'SetMetadata')?.getText().includes("'legacy-public', true")) expect(call(controller, 'UseGuards')).toBeUndefined();
      expect(call(handler, 'UseGuards')).toBeUndefined();
    }
  });
}
test('inventory preserves 144 historical contracts and 136 active contracts synchronized with documentation', () => {
  expect(ORIGINAL_LEGACY_PLATFORM_CONTRACTS).toHaveLength(144);
  expect(RETIRED_LEGACY_PLATFORM_CONTRACTS).toHaveLength(8);
  expect(LEGACY_PLATFORM_CONTRACTS).toHaveLength(136);
  expect(new Set(LEGACY_PLATFORM_CONTRACTS.map(c => `${c.method} ${c.path}`)).size).toBe(136);
  const documentation = readFileSync('../docs/legacy-platform-routes.md', 'utf8');
  for (const c of ORIGINAL_LEGACY_PLATFORM_CONTRACTS) expect(documentation).toContain('`' + c.path + '`');
});
