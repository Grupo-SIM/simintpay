import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { LEGACY_PLATFORM_CONTRACTS } from './legacy-platform-contracts';
import matrix from '../../../../docs/legacy-platform-equivalence.json';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${dir}/${entry.name}`)
      : entry.name.endsWith('.controller.ts')
        ? [`${dir}/${entry.name}`]
        : [],
  );
}
function decorator(node: ts.Node, name: string) {
  return (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [])
    .map((d) => d.expression)
    .find(
      (e): e is ts.CallExpression =>
        ts.isCallExpression(e) && e.expression.getText() === name,
    );
}
function argument(node?: ts.CallExpression) {
  const arg = node?.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : '';
}
const registrations = sourceFiles('src').flatMap((path) => {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements
    .filter(ts.isClassDeclaration)
    .flatMap((controller) => {
      const prefix = decorator(controller, 'Controller');
      if (!prefix) return [];
      return controller.members
        .filter(ts.isMethodDeclaration)
        .flatMap((method) =>
          ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Sse'].flatMap((verb) => {
            const route = decorator(method, verb);
            if (!route) return [];
            const pathname =
              '/' +
              [argument(prefix), argument(route)]
                .map((value) => value.replace(/^\/+|\/+$/g, ''))
                .filter(Boolean)
                .join('/');
            return [
              {
                method: verb === 'Sse' ? 'GET' : verb.toUpperCase(),
                path: pathname,
              },
            ];
          }),
        );
    });
});
function matchesRoute(actual: string, expected: string) {
  const a = actual.split('/'),
    b = expected.split('/');
  return (
    a.length === b.length &&
    a.every((segment, i) => segment.startsWith(':') || segment === b[i])
  );
}
test('all 127 active contracts map uniquely to registered operations and behavioral evidence', () => {
  const keys = (rows: { method: string; path: string }[]) =>
    rows.map((row) => `${row.method} ${row.path}`).sort();
  expect(keys(matrix)).toEqual(keys([...LEGACY_PLATFORM_CONTRACTS]));
  expect(new Set(keys(matrix)).size).toBe(127);
  const documentation = readFileSync(
    '../docs/legacy-platform-equivalence.md',
    'utf8',
  );
  for (const row of matrix) {
    const [method, path] = row.canonical.split(' ');
    expect(
      registrations.some(
        (route) => route.method === method && matchesRoute(route.path, path),
      ),
    ).toBe(true);
    expect(row.evidence.length).toBeGreaterThan(0);
    expect(row.compatibility.length).toBeGreaterThan(20);
    expect(documentation).toContain(`${row.method} ${row.path}`);
    // Structural/delegation suites alone cannot close an equivalence record.
    expect(
      row.evidence.every(
        (file) =>
          !/legacy-(platform-contracts|finance-alias-equivalence|admin-alias-equivalence)\.test/.test(
            file,
          ),
      ),
    ).toBe(true);
    for (const file of row.evidence)
      expect(readFileSync(file, 'utf8')).toMatch(/\b(test|it)\(/);
  }
});
