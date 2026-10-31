import { readFileSync } from 'node:fs';

// --worktree: everything changed since HEAD (manual `bun check`); default: staged files (pre-commit).
const source = process.argv.includes('--worktree') ? 'HEAD' : '--cached';
const diff = Bun.spawnSync(['git', 'diff', source, '--name-only', '-z']);
if (diff.exitCode) process.exit(diff.exitCode);
const files = diff.stdout.toString().split('\0').filter(Boolean);
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const workspaces: { name: string; path: string; dependencies: string[] }[] = [];
for (const pattern of manifest.workspaces as string[]) {
  for await (const path of new Bun.Glob(`${pattern}/package.json`).scan('.')) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    workspaces.push({
      name: pkg.name,
      path: path.slice(0, -13),
      dependencies: Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
      }),
    });
  }
}
const shared = files.some(
  (file) =>
    /^(package.json|bun.lock|turbo.jsonc?|bunfig.toml)$/.test(file) ||
    file.startsWith('scripts/'),
);
const affected = new Set(
  workspaces
    .filter(
      (pkg) => shared || files.some((file) => file.startsWith(`${pkg.path}/`)),
    )
    .map((pkg) => pkg.name),
);
let expanded = true;
while (expanded) {
  expanded = false;
  for (const pkg of workspaces) {
    if (
      !affected.has(pkg.name) &&
      pkg.dependencies.some((name) => affected.has(name))
    ) {
      affected.add(pkg.name);
      expanded = true;
    }
  }
}
if (affected.size) {
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'turbo',
      'run',
      'check-types',
      ...[...affected].flatMap((name) => ['--filter', name]),
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  process.exit(await child.exited);
}
