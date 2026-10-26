import { resolve } from 'node:path';

const cwd = resolve(import.meta.dir, '../backend');
// One process per file prevents Bun module mocks leaking into unrelated suites.
const files = (
  await Array.fromAsync(
    new Bun.Glob('**/*.test.ts').scan({ cwd: resolve(cwd, 'src') }),
  )
)
  .filter((file) => !file.split('/').includes('tests'))
  .sort();
if (!files.length) throw new Error('No unit tests found');
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
let failed = 0;
let completed = 0;
for (const file of files) {
  const child = Bun.spawn(
    [
      'bun',
      '--no-env-file',
      'test',
      '--preload',
      './test/platform-migration.preload.ts',
      `./src/${file}`,
    ],
    {
      cwd,
      // Do not inherit credentials or load developer .env files in tests.
      env: testEnv,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (++completed % 20 === 0)
    console.log(`Checked ${completed}/${files.length} Bun unit files`);
  if (code) {
    failed++;
    console.error(`${file}\n${stdout}${stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} unit test files passed`);
process.exitCode = failed ? 1 : 0;

const jest = Bun.spawn(
  [
    'node',
    '../node_modules/jest/bin/jest.js',
    '--runInBand',
    '--testPathIgnorePatterns=/tests/',
  ],
  { cwd, env: testEnv, stdout: 'inherit', stderr: 'inherit', timeout: 120000 },
);
if (await jest.exited) process.exitCode = 1;
