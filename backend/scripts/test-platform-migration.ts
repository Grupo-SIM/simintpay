import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function testFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(entry => entry.isDirectory() ? testFiles(join(directory, entry.name)) : Promise.resolve(entry.name.endsWith('.test.ts') ? [join(directory, entry.name)] : [])));
  return groups.flat().sort();
}
async function main() {
  const child = spawn(process.execPath, ['test', '--preload', './test/platform-migration.preload.ts', ...await testFiles('src')], {
    env: { ...process.env, DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/platform_migration', DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/platform_migration' },
    stdio: 'inherit',
  });
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
void main().catch(() => { process.exitCode = 1; });
