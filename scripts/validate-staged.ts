const diff = Bun.spawnSync(['git', 'diff', '--cached', '--name-only']);
if (diff.exitCode) process.exit(diff.exitCode);
const files = diff.stdout.toString().trim().split('\n');
if (
  files.some((file) =>
    /^(backend\/|packages\/|package.json$|bun.lock$|turbo.json$|scripts\/)/.test(
      file,
    ),
  )
) {
  const child = Bun.spawn(['bun', 'run', 'check-types'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exit(await child.exited);
}
