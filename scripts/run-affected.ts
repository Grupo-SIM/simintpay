const task = process.env.TASK;
if (!task || !['check-types', 'build', 'test:unit'].includes(task))
  throw new Error('Invalid task');
const packages: string[] = JSON.parse(process.env.TASKS ?? '{}')[task] ?? [];
if (packages.length) {
  const child = Bun.spawn(
    [
      'bunx',
      '--no-install',
      'turbo',
      'run',
      task,
      ...packages.flatMap((name) => ['--filter', name]),
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  process.exit(await child.exited);
}
console.log(`No affected packages for ${task}`);
