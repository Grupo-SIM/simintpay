import { afterAll, beforeAll, expect, test } from 'bun:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  RenewalReminderService,
  reminderEventKey,
} from '../src/modules/billing-core/renewal-reminder.service';

const url = process.env.RENEWAL_REMINDER_TEST_DATABASE_URL;
if (url && new URL(url).hostname !== '127.0.0.1')
  throw new Error('Disposable local database required');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
const run = db ? test : test.skip;

const DAY = 86_400_000;
const NOW = new Date('2026-11-05T12:00:00.000Z');
const uid = () => crypto.randomUUID();

let ids: Record<string, string> = {};
const sent: { to: string; daysRemaining: number }[] = [];
const service = () =>
  new RenewalReminderService(
    db as never,
    {
      sendRenewalReminder: async (i: { to: string; daysRemaining: number }) => {
        sent.push(i);
      },
    } as never,
    { build: ({ contractId }) => `https://x/?renovar=${contractId}` },
  );

beforeAll(async () => {
  if (!db) return;
  const seller = await db.user.create({
    data: { name: 'S', email: `s-${uid()}@t.dev`, password: 'x' },
  });
  const offer = await db.offer.create({
    data: {
      ownerUserId: seller.id,
      createdByUserId: seller.id,
      code: uid().slice(0, 10).toUpperCase(),
      kind: 'SUBSCRIPTION_LINK',
      name: 'Plano',
      amountCents: 19990,
      renewalMode: 'MANUAL_PAY',
      intervalType: 'YEAR',
      intervalCount: 1,
    },
  });
  const make = async (
    key: string,
    days: number,
    status: 'ACTIVE' | 'PAST_DUE' | 'INACTIVE' | 'CANCELLED' = 'ACTIVE',
    card = false,
  ) => {
    const c = await db.billingContract.create({
      data: {
        userId: seller.id,
        offerId: offer.id,
        resourceType: 'OFFER',
        resourceId: `${offer.id}:${key}-${uid()}`,
        unitAmount: '199.90',
        quantity: 1,
        currentPeriodStart: new Date(NOW.getTime() - 300 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() + days * DAY),
        status,
        customerEmail: `${key}-${uid()}@buyer.dev`,
        customerName: key,
      },
    });
    if (card)
      await db.storedCard.create({
        data: {
          ownerUserId: seller.id,
          contractId: c.id,
          customerEmail: c.customerEmail!,
          last4: '4242',
          expMonth: 12,
          expYear: 2030,
        },
      });
    ids[key] = c.id;
  };
  await make('manual', 7);
  await make('pastdue', 0, 'PAST_DUE');
  await make('card', 7, 'ACTIVE', true);
  await make('inactive', 7, 'INACTIVE');
  await make('cancelled', 7, 'CANCELLED');
  await make('far', 15);
}, 60_000);
afterAll(async () => {
  await db?.$disconnect();
});

run(
  'sends one e-mail per contract/period/offset and never to card or dead contracts',
  async () => {
    const mine = new Set(Object.values(ids));
    const mineSent = () => sent.length;
    await service().run(NOW);
    const firstRun = mineSent();
    await service().run(NOW);
    expect(mineSent()).toBe(firstRun);

    const events = await db!.billingContractEvent.findMany({
      where: { contractId: { in: [...mine] } },
    });
    const keys = events.map((e) => e.eventKey).sort();
    const manual = await db!.billingContract.findUniqueOrThrow({
      where: { id: ids.manual },
    });
    const pastDue = await db!.billingContract.findUniqueOrThrow({
      where: { id: ids.pastdue },
    });
    expect(keys).toEqual(
      [
        reminderEventKey(manual.id, manual.currentPeriodEnd, 7),
        reminderEventKey(pastDue.id, pastDue.currentPeriodEnd, 0),
      ].sort(),
    );
    expect(events.every((e) => e.deliveredAt)).toBe(true);
    expect(sent.map((s) => s.daysRemaining).sort()).toEqual([0, 7]);
  },
);
