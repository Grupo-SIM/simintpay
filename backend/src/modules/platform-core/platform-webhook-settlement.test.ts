import { createHmac } from 'node:crypto';
import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformWebhookSettlement } from './platform-webhook-settlement';
import { BosqueWebhookService } from '../bosque/services/bosque-webhook.service';
import { BosqueWebhookController } from '../bosque/controllers/bosque-webhook.controller';
function fixture() {
  const platform = {
    id: 'p',
    tag: 'BOSQUE',
    acquirer: 'DOM' as const,
    ownerUserId: 'new-owner',
    isActive: true,
    owner: { isActive: true },
  };
  const payment = {
    id: 'tx',
    acquirer: 'DOM' as const,
    userId: 'original-owner',
    description: '[TENANT:BOSQUE]',
    platformTag: 'BOSQUE',
    amount: new Prisma.Decimal(10),
    netAmount: new Prisma.Decimal(9),
    externalPaymentId: 'remote',
  };
  const prisma: any = {
    platform: { findUnique: async () => platform },
    transaction: {
      findFirst: mock(async ({ where }: any) =>
        where.platformTag === payment.platformTag ? payment : null,
      ),
    },
    paymentAttempt: { findFirst: mock(async () => null) },
  };
  const processor = { execute: mock(async () => {}) };
  return {
    platform,
    payment,
    prisma,
    processor,
    core: new PlatformWebhookSettlement(prisma, processor as any),
  };
}
test('attempt reference settles only the matching platform and records a late success', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  const reference = `pay_${'a'.repeat(64)}_2`;
  const attempt = {
    id: 'attempt-2',
    externalReference: reference,
    providerPaymentId: 'remote',
    status: 'UNKNOWN',
  };
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.status === 'SUCCEEDED' ? null : attempt,
  );
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 1 }));
  prisma.paymentAttempt.findUniqueOrThrow = mock(async () => ({
    ...attempt,
    status: 'SUCCEEDED',
  }));
  await core.apply(platform, {
    data: { id: 'remote', status: 'paid', cod_external: reference },
  });
  expect(prisma.transaction.findFirst.mock.calls[0][0].where.OR).toContainEqual(
    {
      paymentAttempts: {
        some: { provider: 'DOM', externalReference: reference },
      },
    },
  );
  expect(prisma.paymentAttempt.updateMany).toHaveBeenCalled();
  expect(processor.execute.mock.calls[0][0].transactionId).toBe(payment.id);
});

test('fallback webhook can correlate by provider attempt despite stale transaction acquirer', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  payment.acquirer = 'FRENDZ' as any;
  const reference = `pay_${'a'.repeat(64)}_2`;
  const attempt = {
    id: 'attempt-2',
    externalReference: reference,
    providerPaymentId: 'remote',
    status: 'UNKNOWN',
  };
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.status === 'SUCCEEDED' ? null : attempt,
  );
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 1 }));
  prisma.paymentAttempt.findUniqueOrThrow = mock(async () => ({
    ...attempt,
    status: 'SUCCEEDED',
  }));
  await core.apply(platform, {
    data: { id: 'remote', status: 'paid', cod_external: reference },
  });
  const where = prisma.transaction.findFirst.mock.calls[0][0].where;
  expect(where.acquirer).toBeUndefined();
  expect(where.OR).toContainEqual({
    paymentAttempts: { some: { provider: 'DOM', providerPaymentId: 'remote' } },
  });
  expect(processor.execute).toHaveBeenCalled();
});

test('blocked correlated attempt cannot settle even when transaction matches', async () => {
  const { core, prisma, processor, platform } = fixture();
  const attempt = {
    id: 'attempt-2',
    externalReference: 'pay_tx_2',
    providerPaymentId: 'remote',
    status: 'UNKNOWN',
  };
  prisma.paymentAttempt.findFirst = mock(async () => attempt);
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 0 }));
  expect(
    core.apply(platform, { data: { id: 'remote', status: 'paid' } }),
  ).rejects.toThrow();
  expect(processor.execute).not.toHaveBeenCalled();
});

test('late success contradicting a retryable attempt raises an incident without settlement', async () => {
  const { core, prisma, processor, platform } = fixture();
  prisma.paymentAttempt.findFirst = mock(async () => ({
    id: 'old',
    externalReference: 'pay_tx_1',
    providerPaymentId: 'remote',
    status: 'TERMINAL_NONPAYABLE',
  }));
  expect(
    core.apply(platform, { data: { id: 'remote', status: 'paid' } }),
  ).rejects.toThrow('Pagamento tardio');
  expect(processor.execute).not.toHaveBeenCalled();
});

test('paid webhook before dispatch response records attempt but preserves unbound draft', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  const reference = `pay_${'a'.repeat(64)}_1`;
  payment.externalPaymentId = null as any;
  payment.domPaymentId = null as any;
  payment.status = 'DRAFT' as any;
  const attempt = {
    id: 'early',
    externalReference: reference,
    providerPaymentId: null,
    status: 'DISPATCHING',
  };
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.status === 'SUCCEEDED' ? null : attempt,
  );
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 1 }));
  prisma.paymentAttempt.findUniqueOrThrow = mock(async () => ({
    ...attempt,
    providerPaymentId: 'remote',
    status: 'SUCCEEDED',
  }));
  await core.apply(platform, {
    data: { id: 'remote', status: 'paid', cod_external: reference },
  });
  expect(prisma.paymentAttempt.updateMany).toHaveBeenCalled();
  expect(processor.execute).not.toHaveBeenCalled();
  expect(payment.status).toBe('DRAFT');
});

test('failed webhook before dispatch response records evidence without failing unbound draft', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  const reference = `pay_${'a'.repeat(64)}_1`;
  payment.externalPaymentId = null as any;
  payment.domPaymentId = null as any;
  payment.status = 'DRAFT' as any;
  const attempt = {
    id: 'early',
    externalReference: reference,
    providerPaymentId: null,
    status: 'DISPATCHING',
  };
  prisma.paymentAttempt.findFirst = mock(async () => attempt);
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 1 }));
  prisma.paymentAttempt.findUniqueOrThrow = mock(async () => ({
    ...attempt,
    providerPaymentId: 'remote',
    status: 'FAILED',
  }));
  await core.apply(platform, {
    data: { id: 'remote', status: 'failed', cod_external: reference },
  });
  expect(prisma.paymentAttempt.updateMany).toHaveBeenCalled();
  expect(processor.execute).not.toHaveBeenCalled();
  expect(payment.status).toBe('DRAFT');
});

test('a different successful attempt blocks late credit even when this attempt matched', async () => {
  const { core, prisma, processor, platform } = fixture();
  const attempt = {
    id: 'old',
    externalReference: 'pay_tx_1',
    providerPaymentId: 'remote',
    status: 'UNKNOWN',
  };
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.status === 'SUCCEEDED' ? { id: 'new' } : attempt,
  );
  prisma.paymentAttempt.updateMany = mock(async () => ({ count: 1 }));
  prisma.paymentAttempt.findUniqueOrThrow = mock(async () => ({
    ...attempt,
    status: 'SUCCEEDED',
  }));
  expect(
    core.apply(platform, { data: { id: 'remote', status: 'paid' } }),
  ).rejects.toThrow('Pagamento duplicado');
  expect(processor.execute).not.toHaveBeenCalled();
});

test('payment ID on one attempt cannot rescue reference to a different attempt', async () => {
  const { core, prisma, processor, platform } = fixture();
  const reference = `pay_${'a'.repeat(64)}_2`;
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.externalReference === reference
      ? {
          id: 'by-reference',
          externalReference: reference,
          providerPaymentId: 'other-payment',
        }
      : {
          id: 'by-payment',
          externalReference: `pay_${'a'.repeat(64)}_1`,
          providerPaymentId: 'remote',
        },
  );
  expect(
    core.apply(platform, {
      data: { id: 'remote', status: 'paid', cod_external: reference },
    }),
  ).rejects.toThrow('Pagamento de tentativa divergente');
  expect(
    prisma.paymentAttempt.findFirst.mock.calls[0][0].where,
  ).not.toHaveProperty('OR');
  expect(processor.execute).not.toHaveBeenCalled();
});

test('mismatched provider id and attempt reference cannot settle a transaction', async () => {
  const { core, prisma, processor, platform } = fixture();
  const reference = `pay_${'a'.repeat(64)}_1`;
  prisma.paymentAttempt.findFirst = mock(async () => ({
    externalReference: reference,
    providerPaymentId: 'different-id',
  }));
  expect(
    core.apply(platform, {
      data: { id: 'remote', status: 'paid', cod_external: reference },
    }),
  ).rejects.toThrow();
  expect(processor.execute).not.toHaveBeenCalled();
});

test('post-bind replay settles exactly the already-bound successful attempt without provider calls', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  payment.status = 'PENDING' as any;
  const attempt = {
    id: 'early',
    status: 'SUCCEEDED',
    providerPaymentId: 'remote',
  };
  prisma.paymentAttempt.findFirst = mock(async ({ where }: any) =>
    where.id?.not ? null : attempt,
  );
  expect(await core.reconcileBoundAttempt(platform, payment.id)).toBe(true);
  expect(prisma.transaction.findFirst.mock.calls[0][0].where.id).toBe(
    payment.id,
  );
  expect(prisma.paymentAttempt.findFirst.mock.calls[0][0].where).toMatchObject({
    transactionId: payment.id,
    provider: 'DOM',
    providerPaymentId: 'remote',
    status: 'SUCCEEDED',
  });
  expect(processor.execute.mock.calls[0][0]).toMatchObject({
    transactionId: payment.id,
    payload: {
      data: { paymentId: 'remote', status: 'paid', amountWithoutAllFee: 9 },
    },
  });
});

test('post-bind replay refuses an ID belonging to another provider attempt', async () => {
  const { core, prisma, processor, platform, payment } = fixture();
  prisma.paymentAttempt.findFirst = mock(async () => null);
  expect(await core.reconcileBoundAttempt(platform, payment.id)).toBe(false);
  expect(processor.execute).not.toHaveBeenCalled();
});

test('Bosque legacy ingress and canonical settlement share normalized event, net and dedup key', async () => {
  const { prisma, processor, core, platform } = fixture();
  const alias = new BosqueWebhookController(
    new BosqueWebhookService(prisma, { get: () => processor } as any),
  );
  const body = {
    event: 'payment',
    signature: 'legacy-signature',
    data: { id: 'remote', status: 'paid', amount: 99999 },
  };
  expect(await alias.domWebhook(body)).toBeUndefined();
  await core.apply(platform, body);
  expect(processor.execute.mock.calls[0][0]).toEqual(
    processor.execute.mock.calls[1][0],
  );
  expect(processor.execute.mock.calls[0][0]).toMatchObject({
    transactionId: 'tx',
    payload: { data: { amountWithoutAllFee: 9, status: 'paid' } },
  });
});
test('a payment whose stored platformTag belongs to another platform cannot settle', async () => {
  const { core, platform, payment, processor } = fixture();
  payment.platformTag = 'OTHER';
  await expect(
    core.apply(platform, { data: { id: 'remote', status: 'paid' } }),
  ).rejects.toThrow('Pagamento fora da plataforma');
  expect(processor.execute).not.toHaveBeenCalled();
});
test('legacy missing-payment acknowledgment never delegates unscoped settlement', async () => {
  const { prisma, core, platform, processor } = fixture();
  prisma.transaction.findFirst.mockImplementation(async () => null);
  await core.apply(platform, { data: { id: 'remote', status: 'paid' } }, false);
  expect(processor.execute).not.toHaveBeenCalled();
});

test('canonical webhook without persisted net cannot invent financial snapshot from gross', async () => {
  const { core, platform, payment, processor } = fixture();
  (payment as any).netAmount = null;
  await expect(
    core.apply(platform, { data: { id: 'remote', status: 'paid' } }),
  ).rejects.toMatchObject({
    response: {
      code: 'PLATFORM_CAPABILITY_UNAVAILABLE',
      capability: 'webhooks.net-snapshot',
    },
  });
  expect(processor.execute).not.toHaveBeenCalled();
});

test('Bosque signed alias shares settlement and rejects forged signature before processing', async () => {
  const f = fixture();
  const oldSecret = process.env.DOM_WEBHOOK_SECRET;
  process.env.DOM_WEBHOOK_SECRET = 'mock-only';
  try {
    const alias = new BosqueWebhookController(
      new BosqueWebhookService(f.prisma, { get: () => f.processor } as any),
    );
    const body = { data: { id: 'remote', status: 'paid' } };
    const signature = createHmac('sha256', 'mock-only')
      .update(JSON.stringify(body))
      .digest('hex');
    expect(
      await alias.webhook(body, { 'x-webhook-signature': signature }),
    ).toBeUndefined();
    await f.core.apply(f.platform, body);
    expect(f.processor.execute.mock.calls[0]).toEqual(
      f.processor.execute.mock.calls[1],
    );
    await expect(
      alias.webhook(body, { 'x-webhook-signature': 'forged' }),
    ).rejects.toThrow('Assinatura inválida');
    expect(f.processor.execute).toHaveBeenCalledTimes(2);
  } finally {
    if (oldSecret === undefined) delete process.env.DOM_WEBHOOK_SECRET;
    else process.env.DOM_WEBHOOK_SECRET = oldSecret;
  }
});
