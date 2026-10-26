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
const staged = diff.stdout.toString().split('\0');
for (const workspace of ['backend', 'checkout']) {
  const files = staged.filter((file) =>
    new RegExp(`^${workspace}/src/.*\\.[cm]?[jt]sx?$`).test(file),
  );
  if (!files.length) continue;
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'eslint',
      '--quiet',
      '--fix',
      ...files.map((file) => relative(resolve(workspace), resolve(file))),
    ],
    { cwd: workspace, stdout: 'inherit', stderr: 'inherit' },
  );
  const code = await child.exited;
  if (code) process.exit(code);
}
