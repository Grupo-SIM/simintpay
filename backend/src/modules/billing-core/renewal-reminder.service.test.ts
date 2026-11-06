import { describe, expect, it } from 'bun:test';
import { Prisma } from '@prisma/client';
import type { RenewalLinkBuilder } from './renewal-link';
import {
  RenewalReminderService,
  reminderEventKey,
} from './renewal-reminder.service';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

type Contract = {
  id: string;
  currentPeriodEnd: Date;
  customerEmail: string | null;
  customerName: string;
  unitAmount: number;
  quantity: number;
  offer: { name: string; code: string } | null;
};
const contract = (
  id: string,
  days: number,
  extra: Partial<Contract> = {},
): Contract => ({
  id,
  currentPeriodEnd: at(days),
  customerEmail: `${id}@buyer.dev`,
  customerName: 'Buyer',
  unitAmount: 199.9,
  quantity: 1,
  offer: { name: 'Plano Anual', code: 'ABC123' },
  ...extra,
});

function setup(contracts: Contract[], failSend = false) {
  const events = new Map<
    string,
    { id: string; deliveredAt: Date | null; attempts: number }
  >();
  const sent: { to: string; daysRemaining: number; renewUrl: string }[] = [];
  const prisma = {
    billingContract: { findMany: async () => contracts },
    billingContractEvent: {
      create: async ({ data }: { data: { eventKey: string } }) => {
        if (events.has(data.eventKey))
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'x',
          });
        const row = { id: `e${events.size}`, deliveredAt: null, attempts: 0 };
        events.set(data.eventKey, row);
        return { id: row.id };
      },
      findUnique: async ({ where }: { where: { eventKey: string } }) =>
        events.get(where.eventKey) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { deliveredAt?: Date };
      }) => {
        const row = [...events.values()].find((e) => e.id === where.id)!;
        if (data.deliveredAt) row.deliveredAt = data.deliveredAt;
        row.attempts++;
        return row;
      },
    },
  };
  const email = {
    sendRenewalReminder: async (input: {
      to: string;
      daysRemaining: number;
      renewUrl: string;
    }) => {
      if (failSend) throw new Error('smtp down');
      sent.push(input);
    },
  };
  const links: RenewalLinkBuilder = {
    build: ({ contractId, offerCode }) =>
      `https://x/?${offerCode}&${contractId}`,
  };
  const service = new RenewalReminderService(
    prisma as never,
    email as never,
    links,
  );
  return { service, sent, events };
}

describe('RenewalReminderService', () => {
  it('sends only on the 30/7/1/0 day offsets', async () => {
    const { service, sent } = setup([
      contract('c30', 30),
      contract('c7', 7),
      contract('c1', 1),
      contract('c0', 0),
      contract('c15', 15),
      contract('c2', 2),
    ]);
    const result = await service.run(NOW);
    expect(result).toEqual({ considered: 4, sent: 4, skipped: 0, failed: 0 });
    expect(sent.map((s) => s.daysRemaining).sort((a, b) => a - b)).toEqual([
      0, 1, 7, 30,
    ]);
    expect(sent[0].renewUrl).toContain('ABC123');
  });

  it('sends once per (contract, periodEnd, offset) across runs', async () => {
    const { service, sent, events } = setup([contract('c7', 7)]);
    await service.run(NOW);
    const second = await service.run(NOW);
    expect(sent).toHaveLength(1);
    expect(second.skipped).toBe(1);
    expect(events.has(reminderEventKey('c7', at(7), 7))).toBe(true);
  });

  it('does not mark a failed send as delivered and retries it next run', async () => {
    const failing = setup([contract('c1', 1)], true);
    const first = await failing.service.run(NOW);
    expect(first.failed).toBe(1);
    const event = [...failing.events.values()][0];
    expect(event.deliveredAt).toBeNull();
    expect(event.attempts).toBe(1);

    // Same event store, working mailer: the undelivered event is retried.
    const ok = setup([contract('c1', 1)]);
    ok.events.set(reminderEventKey('c1', at(1), 1), event);
    const retry = await ok.service.run(NOW);
    expect(retry.sent).toBe(1);
    expect(event.deliveredAt).not.toBeNull();
  });

  it('skips contracts without e-mail or offer', async () => {
    const { service, sent } = setup([
      contract('a', 7, { customerEmail: null }),
      contract('b', 7, { offer: null }),
    ]);
    expect((await service.run(NOW)).sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
