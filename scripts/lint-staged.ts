import { relative, resolve } from 'node:path';
const diff = Bun.spawnSync([
  'git',
  'diff',
  '--cached',
  '--name-only',
  '--diff-filter=AM',
  '-z',
]);
if (diff.exitCode) process.exit(diff.exitCode);
const files = diff.stdout
  .toString()
  .split('\0')
  .filter((file) => /^backend\/src\/.*\.ts$/.test(file));
if (files.length) {
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'eslint',
      '--quiet',
      '--fix',
      ...files.map((file) => relative(resolve('backend'), resolve(file))),
    ],
    {
      cwd: 'backend',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  );
  process.exit(await child.exited);
}
