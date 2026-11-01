import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Logger } from '@nestjs/common';
import { WalletConsistencyCron } from '../src/infrastructure/cron/wallet-consistency.cron';

const row = (userId: string, balance = '10.00') => ({
  userId,
  email: `${userId}@example.com`,
  balance,
  lockedBalance: '0',
  ledgerBalance: '5.00',
  ledgerLockedBalance: '0',
  drift: '5.00',
  lockedDrift: '0',
});

function setup(impl: () => Promise<unknown[]>) {
  const prisma = { $queryRaw: async () => impl() };
  const cron = new WalletConsistencyCron(prisma as never);
  const errors: string[] = [];
  (cron as any).logger = Object.assign(new Logger('t'), {
    log: () => undefined,
    warn: () => undefined,
    error: (m: string) => errors.push(m),
  });
  return { cron, errors };
}

describe('WalletConsistencyCron alerting', () => {
  test('no divergence -> no alert', async () => {
    const { cron, errors } = setup(async () => []);
    await cron.handleCron();
    expect(errors).toHaveLength(0);
  });

  test('divergence -> exactly one alert with count and userIds only; identical set not repeated', async () => {
    const { cron, errors } = setup(async () => [row('u1'), row('u2')]);
    await cron.handleCron();
    await cron.handleCron();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('2 carteira(s)');
    expect(errors[0]).toContain('u1');
    expect(errors[0]).not.toContain('@example.com');
  });

  test('changed set alerts again', async () => {
    let rows = [row('u1')];
    const { cron, errors } = setup(async () => rows);
    await cron.handleCron();
    rows = [row('u1'), row('u3')];
    await cron.handleCron();
    expect(errors).toHaveLength(2);
  });

  test('survives a query failure and overlapping runs', async () => {
    const { cron, errors } = setup(async () => {
      throw new Error('db down');
    });
    await expect(cron.handleCron()).resolves.toEqual([]);
    expect(errors).toHaveLength(1);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const second = setup(async () => {
      calls++;
      await gate;
      return [];
    });
    const first = second.cron.handleCron();
    await second.cron.handleCron();
    release();
    await first;
    expect(calls).toBe(1);
  });
});
