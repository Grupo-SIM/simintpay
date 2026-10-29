import { resolve } from 'node:path';

/**
 * Backend unit tests. By default only files affected by uncommitted changes run (Bun resolves the
 * import graph through git); pass --all for the whole suite, or --since=<ref> to compare against a ref.
 * Bun isolates every test file in its own worker, so module mocks cannot leak between suites.
 */
const cwd = resolve(import.meta.dir, '../backend');
const all = process.argv.includes('--all');
const since =
  process.argv.find((arg) => arg.startsWith('--since='))?.slice(8) ?? 'HEAD';
const testEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unit',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/unit',
  RABBITMQ_URL: 'amqp://test:test@127.0.0.1:1',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '1',
};
const run = async (cmd: string[]) =>
  Bun.spawn(cmd, { cwd, env: testEnv, stdout: 'inherit', stderr: 'inherit' })
    .exited;

// Files under `tests/` are integration scenarios that need an isolated database.
const bun = await run([
  'bun',
  '--no-env-file',
  'test',
  '--preload',
  './test/platform-migration.preload.ts',
  `--parallel=${Math.min(navigator.hardwareConcurrency, 8)}`,
  '--path-ignore-patterns=**/tests/**',
  '--path-ignore-patterns=**/*.spec.ts',
  ...(all ? ['./src'] : [`--changed=${since}`]),
]);

// Legacy Jest specs: related files only, unless --all.
const jest = await run([
  'node',
  '../node_modules/jest/bin/jest.js',
  '--passWithNoTests',
  '--testPathIgnorePatterns=/tests/',
  ...(all ? [] : [`--changedSince=${since}`]),
]);
process.exitCode = bun || jest ? 1 : 0;
