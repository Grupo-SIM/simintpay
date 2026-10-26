import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { SalePushService } from '../sale-push.service';

const sendNotification = jest.fn().mockResolvedValue({});
jest.mock('web-push', () => ({ sendNotification: (...args: unknown[]) => sendNotification(...args) }));

const connectionString = process.env.SALE_PUSH_INTEGRATION_URL;
if (connectionString) {
  const url = new URL(connectionString);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/simintpay_client_migration_validation') {
    throw new Error('Push integration tests require disposable localhost database simintpay_client_migration_validation');
  }
}
const localDescribe = connectionString ? describe : describe.skip;
localDescribe('Sale push persistence (disposable LOCAL PostgreSQL; mocked provider)', () => {
  let prisma: PrismaClient;
  let service: SalePushService;
  const userIds = [`push-test-${randomUUID()}`, `push-test-${randomUUID()}`];
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const subscription = { endpoint, keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) } };
  const previousConfig = [process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY, process.env.VAPID_SUBJECT];
  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString! }) });
    service = new SalePushService(prisma as never);
    process.env.VAPID_PUBLIC_KEY = 'simulated-public';
    process.env.VAPID_PRIVATE_KEY = 'simulated-private';
    process.env.VAPID_SUBJECT = 'mailto:local@example.test';
    await prisma.user.createMany({ data: userIds.map(id => ({ id, name: 'Local fixture', email: `${id}@example.test`, password: 'test-only', clientStatus: 'APPROVED' })) });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.$disconnect();
    }
    ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].forEach((key, index) => {
      if (previousConfig[index] === undefined) delete process.env[key]; else process.env[key] = previousConfig[index];
    });
  });
  it('registers devices, captures approval atomically, isolates account swaps and processes deliveries', async () => {
    await service.subscribe(userIds[0], subscription);
    const second = { ...subscription, endpoint: `${endpoint}-second` };
    await service.subscribe(userIds[0], second);
    const sale = await prisma.transaction.create({ data: { userId: userIds[0], amount: 29.99, status: 'PENDING' } });
    await prisma.transaction.update({ where: { id: sale.id }, data: { status: 'COMPLETED' } });
    await prisma.transaction.update({ where: { id: sale.id }, data: { status: 'COMPLETED' } });
    const event = await prisma.salePushEvent.findFirstOrThrow({ where: { transactionId: sale.id, userId: userIds[0] } });
    expect(await prisma.pushDelivery.count({ where: { eventId: event.id } })).toBe(2);
    await service.subscribe(userIds[1], subscription);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).toMatchObject({ userId: userIds[1] });
    expect(await prisma.pushDelivery.count({ where: { eventId: event.id } })).toBe(1);
    await service.unsubscribe(userIds[0], endpoint);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(1);
    await service.processPending();
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual({ saleId: sale.id, amount: 29.99 });
    expect(await prisma.pushDelivery.findFirst({ where: { eventId: event.id } })).toMatchObject({ status: 'SENT', attempts: 1 });
    await service.unsubscribe(userIds[1], endpoint);
    expect(await prisma.pushSubscription.count({ where: { endpoint } })).toBe(0);
  });
});
