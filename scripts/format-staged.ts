// Preserve pure file moves; only format added/modified files during migration.
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
  .filter((file) => /\.(ts|js|mjs|cjs|json|yml|yaml|md)$/.test(file));
if (files.length) {
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'prettier',
      '--write',
      '--ignore-unknown',
      ...files,
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  process.exit(await child.exited);
}
