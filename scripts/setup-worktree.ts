import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Prepares a git worktree so it is usable in seconds instead of running a full install in each one:
 * 1. installs dependencies with the project's package manager in frozen mode (Bun hardlinks from its cache, cheap on
 *    btrfs metadata, unlike reflink-cloning `node_modules`), serialized through a few `flock` slots so several
 *    worktrees created at once do not fight over disk and CPU (`WORKTREE_INSTALL_SLOTS`, default 2);
 * 2. when the project uses Turbo, shares the main checkout's Turbo cache so builds and type-checks are not repeated
 *    per worktree.
 *
 * The package manager comes from `packageManager` in package.json, then from the lockfile (bun, pnpm, yarn, npm).
 *
 * Usage: `bun scripts/setup-worktree.ts [worktree-dir]` (defaults to the current directory). Idempotent.
 */

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

const run = (cwd: string, command: string, ...args: string[]) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout;
};

const hasCommand = (name: string) =>
  spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status ===
  0;

const target = resolve(process.argv[2] ?? process.cwd());
const top = run(target, 'git', 'rev-parse', '--show-toplevel').trim();
const main = run(top, 'git', 'worktree', 'list', '--porcelain')
  .split('\n')[0]
  ?.replace(/^worktree /, '');
if (!main) throw new Error('Could not find the main worktree.');
const isMain = resolve(main) === resolve(top);
const startedAt = performance.now();

const detectPackageManager = (): PackageManager | undefined => {
  const manifest = join(top, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const declared = /^(bun|npm|pnpm|yarn)@/.exec(
    JSON.parse(readFileSync(manifest, 'utf8')).packageManager ?? '',
  )?.[1];
  if (declared) return declared as PackageManager;
  const lockfiles: [string, PackageManager][] = [
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ];
  return lockfiles.find(([file]) => existsSync(join(top, file)))?.[1];
};

const installCommand = (manager: PackageManager) => {
  switch (manager) {
    case 'bun':
      return ['bun', 'install', '--frozen-lockfile'];
    case 'pnpm':
      return ['pnpm', 'install', '--frozen-lockfile'];
    case 'yarn':
      return existsSync(join(top, '.yarnrc.yml'))
        ? ['yarn', 'install', '--immutable']
        : ['yarn', 'install', '--frozen-lockfile'];
    case 'npm':
      return ['npm', 'ci'];
  }
};

const warnIfCacheCrossesFilesystems = () => {
  const cache =
    process.env.BUN_INSTALL_CACHE_DIR ??
    join(
      process.env.BUN_INSTALL ?? join(homedir(), '.bun'),
      'install',
      'cache',
    );
  if (existsSync(cache) && statSync(cache).dev !== statSync(top).dev) {
    console.warn(
      `Bun cache (${cache}) is on another filesystem than the worktree: Bun copies instead of hardlinking. ` +
        "Point BUN_INSTALL_CACHE_DIR to the worktrees' disk.",
    );
  }
};

const exitCode = (command: string[]) =>
  new Promise<number>((done) => {
    const [bin = '', ...args] = command;
    const child = spawn(bin, args, { cwd: top, stdio: 'inherit' });
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });

const install = async (command: string[]) => {
  const slots = Math.max(1, Number(process.env.WORKTREE_INSTALL_SLOTS) || 2);
  if (!hasCommand('flock')) {
    console.warn('`flock` not found: installing without a concurrency limit.');
    return exitCode(command);
  }
  const lockDir = join(
    process.env.XDG_RUNTIME_DIR ?? tmpdir(),
    'worktree-install-locks',
  );
  mkdirSync(lockDir, { recursive: true });
  const busy = 99;
  for (;;) {
    for (let slot = 0; slot < slots; slot++) {
      const lock = join(lockDir, `slot-${slot}.lock`);
      const code = await exitCode([
        'flock',
        '-n',
        '-E',
        String(busy),
        lock,
        ...command,
      ]);
      if (code !== busy) return code;
    }
    await sleep(1000);
  }
};

const shareTurboCache = () => {
  const shared = join(main, '.turbo', 'cache');
  const local = join(top, '.turbo', 'cache');
  mkdirSync(shared, { recursive: true });
  mkdirSync(dirname(local), { recursive: true });
  const current = lstatSync(local, { throwIfNoEntry: false });
  if (current?.isSymbolicLink()) return;
  if (current?.isDirectory()) {
    if (readdirSync(local).length) return;
    rmdirSync(local);
  }
  symlinkSync(shared, local, 'dir');
  console.log('Linked the Turbo cache to the main checkout.');
};

const finish = (code: number) => {
  console.log(
    `Worktree ready in ${((performance.now() - startedAt) / 1000).toFixed(1)}s.`,
  );
  process.exit(code);
};

const setup = async () => {
  const manager = detectPackageManager();
  if (!manager) {
    console.warn(
      'No package.json with a known lockfile found: nothing to install.',
    );
    return 0;
  }
  if (!isMain && existsSync(join(top, 'turbo.json'))) shareTurboCache();
  if (manager === 'bun') warnIfCacheCrossesFilesystems();
  return install(installCommand(manager));
};

setup().then(finish);
