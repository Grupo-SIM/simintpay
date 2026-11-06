import { afterEach, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PlatformSalesEventsService } from './platform-sales-events.service';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function fixture() {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  const secret = encryptPlatformSecret('webhook-secret');
  const rows: any[] = [];
  const tx = { id: 'tx', userId: 'owner', status: 'COMPLETED', amount: new Prisma.Decimal(27), netAmount: new Prisma.Decimal(24), paymentMethod: 'PIX', tracking: { utm_content: 'A1' }, pixContent: '000201', pixExpire: new Date(Date.now() + 3600_000), createdAt: new Date(), updatedAt: new Date(), paymentLinkId: 'link', customerEmail: 'maria@example.com', customerPhone: '5511999999999', customerName: 'Maria', customerDocument: '52998224725', statusHistory: [], paymentLink: { title: 'Livro', webhookUrl: 'https://central.test/api/simintpay/webhook', emailBody: 'Obrigado!', redirectUrl: 'https://central.test/obrigado', files: [{ fileName: 'ebook.pdf', fileUrl: 'https://storage.test/ebook.pdf' }] } };
  const email = { sendEbookAccessEmail: mock(async (_input: any) => {}) };
  const storage = { getReceiptBufferByStoredUrl: mock(async () => ({ buffer: Buffer.from('%PDF-1.7') })) };
  const prisma = {
    platform: { findUnique: mock(async () => ({ isActive: true, owner: { isActive: true, isPurged: false } })), findMany: mock(async () => [{ id: 'p', tag: 'CENTRAL-INFO', ownerUserId: 'owner', owner: { isActive: true }, integrations: [] }]) },
    transaction: { findMany: mock(async () => [tx]), findUnique: mock(async () => tx) },
    platformIntegration: { findUnique: mock(async () => ({ encryptedValue: secret })) },
    charge: { findMany: mock(async (): Promise<any[]> => []) },
    paymentLinkOfferSale: { findMany: mock(async () => []) },
    paymentLinkOffer: { findMany: mock(async () => []) },
    $executeRaw: mock(async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join('?');
      if (sql.startsWith('INSERT')) {
        if (!rows.some(r => r.eventId === values[0])) rows.push({ sequence: BigInt(rows.length + 1), eventId: values[0], platformId: values[1], url: values[2], payload: JSON.parse(values[3]), attempts: 0, deliveredAt: null, emailDeliveredAt: null });
      } else {
        const row = rows.find(r => r.eventId === values.at(-1));
        if (sql.includes('"deliveredAt" = NOW()')) row.deliveredAt = new Date();
        if (sql.includes('"emailDeliveredAt" = NOW()')) row.emailDeliveredAt = new Date();
        if (sql.includes('"lastError" = ?')) row.attempts++;
      }
      return 1;
    }),
    $queryRaw: mock(async (parts: TemplateStringsArray, ...values: any[]) => parts.join('?').includes('"platformId" =') ? rows.filter(r => r.platformId === values[0] && r.sequence > values[1]) : rows.filter(r => !r.deliveredAt || (r.payload.event === 'purchase_approved' && !r.emailDeliveredAt))),
  };
  const modules = { get: (token: { name: string }) => token.name === 'EmailService' ? email : storage };
  const service = new PlatformSalesEventsService(prisma as never, modules as never);
  return { rows, tx, prisma, service, email };
}
test('outbox signs exact body, excludes document, delivers PDFs and deduplicates snapshots', async () => {
  const f = fixture();
  const requests: any[] = [];
  globalThis.fetch = mock(async (_url: any, init: any) => {
    requests.push(init);
    expect(init.headers['x-simintpay-signature']).toBe(createHmac('sha256', 'webhook-secret').update(init.body).digest('hex'));
    expect(init.body).not.toContain('52998224725');
    return new Response('ok');
  }) as typeof fetch;
  await f.service.run();
  await f.service.run();
  expect(f.rows).toHaveLength(2);
  expect(requests).toHaveLength(2);
  expect(f.rows.find(r => r.payload.event === 'purchase_approved').payload).toMatchObject({ amountCents: 2700, netAmountCents: 2400, tracking: { utm_content: 'A1' } });
  expect(f.email.sendEbookAccessEmail).toHaveBeenCalledTimes(1);
  expect(f.email.sendEbookAccessEmail.mock.calls[0][0].attachments).toHaveLength(1);
});
test('HTTP failure leaves durable retry and identical event identity', async () => {
  const f = fixture();
  globalThis.fetch = mock(async () => new Response('unavailable', { status: 503 })) as typeof fetch;
  await f.service.run();
  const id = f.rows[0].eventId;
  expect(f.rows[0].attempts).toBe(1);
  expect(f.rows[0].deliveredAt).toBeNull();
  globalThis.fetch = mock(async () => new Response('ok')) as typeof fetch;
  await f.service.run();
  expect(f.rows[0].eventId).toBe(id);
  expect(f.rows[0].deliveredAt).toBeInstanceOf(Date);
});
test('history is tenant-scoped, paginated, replayable after delivery', async () => {
  const f = fixture();
  await f.service.capture();
  const result = await f.service.history({ id: 'p' } as never, '0');
  expect(result.events).toHaveLength(2);
  expect(result.nextCursor).toBe('2');
  expect((await f.service.history({ id: 'other' } as never, '0')).events).toHaveLength(0);
  expect((await f.service.history({ id: 'p' } as never, '2')).events).toHaveLength(0);
});
test('refund and chargeback preserve approved history; no raw card or document', async () => {
  const f = fixture();
  f.tx.status = 'CHARGEBACK';
  f.tx.statusHistory = [{ toStatus: 'COMPLETED', createdAt: new Date() }] as never;
  await f.service.capture();
  expect(f.rows.map(r => r.payload.event)).toContain('chargeback');
  expect(f.rows.map(r => r.payload.event)).toContain('purchase_approved');
});
test('offer sales carry the sold items and offer ids to the platform webhook', async () => {
  const f = fixture();
  Object.assign(f.tx, { paymentLinkId: null, paymentLink: null });
  f.prisma.charge.findMany.mockImplementation(async () => [{ id: 'ch', transactionId: 'tx', offerId: 'o1', snapshot: { items: [{ role: 'MAIN', offerId: 'o1', title: 'Curso', amountCents: 2500 }, { role: 'BUMP', offerId: 'o2', title: 'Bônus', amountCents: 200 }] }, offer: { id: 'o1', name: 'Curso', amountCents: 2500, legacyType: null, legacyId: null } }]);
  f.prisma.platform.findMany.mockImplementation(async () => [{ id: 'p', tag: 'CENTRAL-INFO', ownerUserId: 'owner', owner: { isActive: true }, integrations: [{ key: 'WEBHOOK_URL', url: 'https://central.test/hook' }] }] as any);
  await f.service.capture();
  expect(f.rows.find(r => r.payload.event === 'purchase_approved').payload).toMatchObject({
    offerId: 'o1', chargeId: 'ch', linkId: 'o1',
    items: [{ tipo: 'PRINCIPAL', titulo: 'Curso', valor: 25 }, { tipo: 'ORDER_BUMP', offerId: 'o2', titulo: 'Bônus', valor: 2 }],
  });
});
