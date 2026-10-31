/**
 * `bun check`: types, lint and unit tests for what changed, running concurrently.
 *
 *   bun check                 everything changed since HEAD
 *   bun check --staged        only staged files (pre-commit)
 *   bun check --skip-lint     leave lint to a separate fixing step (pre-commit does this)
 *   bun check --all           full backend unit suite
 *   bun check --only=backend  one workspace (`bun run check` inside backend/, checkout/ or frontend/ does this)
 */
import { resolve } from 'node:path';

process.chdir(resolve(import.meta.dir, '..'));
const args = process.argv.slice(2);
const only = args.find((arg) => arg.startsWith('--only='))?.slice(7);
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
const files = diff.stdout
  .toString()
  .split('\0')
  .filter((file) => Boolean(file) && (!only || file.startsWith(`${only}/`)));
const touches = (prefix: string) =>
  files.some((file) => file.startsWith(prefix));
const shared =
  !only &&
  files.some(
    (file) =>
      /^(package.json|bun.lock|turbo.jsonc?|bunfig.toml)$/.test(file) ||
      file.startsWith('scripts/') ||
      file.startsWith('backend/prisma/'),
  );
const runs = (workspace: string) =>
  (!only || only === workspace) && (all || shared || touches(`${workspace}/`));
const turbo = ['bunx', '--no-install', 'turbo', 'run'];

const tasks: { name: string; cmd: string[] }[] = [
  {
    name: 'types',
    cmd: only
      ? [...turbo, 'check-types', '--filter', only]
      : ['bun', 'scripts/validate-staged.ts', ...scope],
  },
];
if (!args.includes('--skip-lint')) {
  tasks.push({
    name: 'lint',
    cmd: [
      'bun',
      'scripts/lint-staged.ts',
      '--no-fix',
      ...scope,
      ...(only ? [`--only=${only}`] : []),
    ],
  });
}
if (runs('backend')) {
  tasks.push({
    name: 'unit',
    cmd: ['bun', 'scripts/test-unit.ts', ...(all || shared ? ['--all'] : [])],
  });
}
if (runs('checkout')) {
  tasks.push({
    name: 'checkout-unit',
    cmd: [...turbo, 'test:unit', '--filter', 'checkout'],
  });
}

const run = async (cmd: string[]) => {
  const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
};

// Types and unit tests both read the generated Prisma Client. Generate it once, before they run side
// by side (turbo caches it on the schema, so this is instant unless prisma/schema.prisma changed).
if (!only || only === 'backend') {
  const generate = await run([...turbo, 'generate', '--filter', 'backend']);
  if (generate.code) {
    console.error(`✖ generate\n${generate.out}${generate.err}`);
    process.exit(1);
  }
}

const results = await Promise.all(
  tasks.map(async ({ name, cmd }) => {
    const started = performance.now();
    const { out, err, code } = await run(cmd);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`${code ? '✖' : '✔'} ${name} (${seconds}s)`);
    if (code) console.error(`${out}${err}`);
    return code;
  }),
);
process.exit(results.some(Boolean) ? 1 : 0);
