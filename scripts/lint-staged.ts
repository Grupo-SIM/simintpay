import { relative, resolve } from 'node:path';
// --worktree: files changed since HEAD; --no-fix: report only (used by `bun check`).
const source = process.argv.includes('--worktree') ? 'HEAD' : '--cached';
const fix = !process.argv.includes('--no-fix');
const diff = Bun.spawnSync([
  'git',
  'diff',
  source,
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
      ...(fix ? ['--fix'] : []),
      ...files.map((file) => relative(resolve(workspace), resolve(file))),
    ],
    { cwd: workspace, stdout: 'inherit', stderr: 'inherit' },
  );
  const code = await child.exited;
  if (code) process.exit(code);
}
