/**
 * `bun check`: types, lint and unit tests for what changed, running concurrently.
 *
 *   bun check                 everything changed since HEAD
 *   bun check --staged        only staged files (pre-commit)
 *   bun check --skip-lint     leave lint to a separate fixing step (pre-commit does this)
 *   bun check --all           full backend unit suite
 */
const args = process.argv.slice(2);
const staged = args.includes('--staged');
const all = args.includes('--all');
const scope = staged ? [] : ['--worktree'];

const diff = Bun.spawnSync([
  'git',
  'diff',
  staged ? '--cached' : 'HEAD',
  '--name-only',
  '-z',
]);
if (diff.exitCode) process.exit(diff.exitCode);
const files = diff.stdout.toString().split('\0').filter(Boolean);
const touches = (prefix: string) =>
  files.some((file) => file.startsWith(prefix));
const shared = files.some(
  (file) =>
    /^(package.json|bun.lock|turbo.json|bunfig.toml)$/.test(file) ||
    file.startsWith('scripts/') ||
    file.startsWith('backend/prisma/'),
);

const tasks: { name: string; cmd: string[] }[] = [
  { name: 'types', cmd: ['bun', 'scripts/validate-staged.ts', ...scope] },
];
if (!args.includes('--skip-lint')) {
  tasks.push({
    name: 'lint',
    cmd: ['bun', 'scripts/lint-staged.ts', '--no-fix', ...scope],
  });
}
if (all || shared || touches('backend/')) {
  tasks.push({
    name: 'unit',
    cmd: ['bun', 'scripts/test-unit.ts', ...(all || shared ? ['--all'] : [])],
  });
}
if (all || shared || touches('checkout/')) {
  tasks.push({
    name: 'checkout-unit',
    cmd: [
      'bunx',
      '--no-install',
      'turbo',
      'run',
      'test:unit',
      '--filter',
      'checkout',
    ],
  });
}

const results = await Promise.all(
  tasks.map(async ({ name, cmd }) => {
    const started = performance.now();
    const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`${code ? '✖' : '✔'} ${name} (${seconds}s)`);
    if (code) console.error(`${out}${err}`);
    return code;
  }),
);
process.exit(results.some(Boolean) ? 1 : 0);
