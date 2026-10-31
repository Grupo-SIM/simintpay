import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformPaymentsService } from './platform-payments.service';
import { encryptPlatformSecret } from '../../platform-integrations/platform-secrets';
import {
  CircuitOpenException,
  CircuitUnavailableException,
} from '../../../infrastructure/resilience/payment-circuit-breaker';
import { markDefinitiveDomRejection } from './dom-rejection';

const context = {
  id: 'platform',
  tag: 'CLIENT',
  ownerUserId: 'owner',
  acquirer: 'DOM' as const,
};
const input = {
  amountCents: 12345,
  paymentMethod: 'PIX' as const,
  idempotencyKey: 'purchase-1',
  customer: {
    name: 'Maria Silva',
    email: 'maria@example.com',
    document: '52998224725',
    documentType: 'CPF' as const,
  },
};

function fixture(acquirer: 'DOM' | 'FRENDZ' = 'DOM') {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
  const platform = {
    ...context,
    acquirer,
    deliveryFeeMode: 'ADDITIVE_ONLY',
    isActive: true,
    owner: { isActive: true, isPurged: false },
    integrations: [
      {
        key: acquirer === 'DOM' ? 'DOM_TOKEN' : 'FRENDZ_TOKEN',
        encryptedValue: encryptPlatformSecret('mock-token'),
      },
    ],
  };
  let stored: any;
  const prisma = {
    $queryRaw: mock(async () => [] as any[]),
    financialPolicyRevision: { findMany: mock(async () => []) },
    acquirerCatalogue: { findMany: mock(async () => []) },
    acquirerFeeSchedule: { findMany: mock(async () => []) },
    platformTaxaOverride: { findMany: mock(async () => []) },
    platform: { findUnique: mock(async () => platform) },
    wallet: {
      findUnique: mock(async () => ({ id: 'wallet' })),
      upsert: mock(async () => ({ id: 'wallet' })),
    },
    paymentAttempt: {
      findFirst: mock(async () => null),
    },
    transaction: {
      findFirst: mock(async () => stored ?? null),
      findUnique: mock(async () => stored ?? null),
      findUniqueOrThrow: mock(async () => stored),
      create: mock(async ({ data }: any) => {
        stored = data;
        return stored;
      }),
      update: mock(async ({ data }: any) => {
        stored = { ...stored, ...data };
        return stored;
      }),
      updateMany: mock(async ({ where, data }: any) => {
        if (stored?.status === where.status) stored = { ...stored, ...data };
        return { count: 1 };
      }),
    },
  };
  const charge = mock(async () => ({
    id: 'gateway-payment',
    status: 'pending',
    amount: 123.45,
    pixContent: 'mock-pix',
    qrCode: 'mock-qr',
    pixExpire: null,
  }));
  const gateways = { byAcquirer: mock(() => ({ createPixCheckout: charge })) };
  const attempts = {
    reserve: mock(async (transactionId: string, provider: string) => {
      const sequence = attempts.reserve.mock.calls.length;
      return {
        kind: 'reserved' as const,
        attempt: {
          id: `${transactionId}:${sequence}`,
          transactionId,
          provider,
          sequence,
          externalReference: `pay_${transactionId}_${sequence}`,
        },
      };
    }),
    claimDispatch: mock(async (attemptId: string) => ({
      kind: 'claimed' as const,
      attempt: { id: attemptId },
      leaseToken: 'test-lease',
    })),
    recordProviderResponse: mock(async () => true),
    markUnknown: mock(async () => true),
    markPreCreationFailed: mock(async () => true),
    markReservedPreDispatchFailed: mock(async () => true),
    inspectRetryEligibility: mock(async () => ({
      kind: 'eligible' as const,
      nextSequence: 2,
    })),
  };
  const webhookProcessor = { execute: mock(async () => undefined) };
  const breaker = {
    begin: mock(async (provider: string, operation: string) => ({
      provider,
      operation,
      token: 'test-permit',
      fence: 1n,
      probe: false,
    })),
    complete: mock(async () => undefined),
  };
  return {
    service: new PlatformPaymentsService(
      prisma as never,
      gateways as never,
      attempts as never,
      breaker as never,
      webhookProcessor as never,
    ),
    prisma,
    platform,
    charge,
    gateways,
    attempts,
    breaker,
    webhookProcessor,
  };
}

function allowFallback(f: ReturnType<typeof fixture>) {
  f.platform.integrations.push({
    key: 'FRENDZ_TOKEN',
    encryptedValue: encryptPlatformSecret('frendz-token'),
  });
  f.prisma.acquirerCatalogue.findMany.mockResolvedValue([
    { code: 'DOM', active: true },
    { code: 'FRENDZ', active: true },
  ]);
  f.prisma.acquirerFeeSchedule.findMany.mockResolvedValue(
    (['DOM', 'FRENDZ'] as const).map((acquirerCode, index) => ({
      id: acquirerCode,
      acquirerCode,
      fixedCents: index * 10,
      ratePpm: 0,
      interestPpm: 0,
      base: 'ORIGINAL',
      source: 'manual',
      createdAt: new Date('2026-01-01'),
    })),
  );
}

describe('platform payment core', () => {
  test('DOM receives reais and canonical output preserves integer cents', async () => {
    const { service, charge, prisma } = fixture();
    expect(await service.create(context, input)).toMatchObject({
      amountCents: 12345,
      paymentId: 'gateway-payment',
    });
    expect((charge.mock.calls as any)[0][1].amount).toBe(123.45);
    expect((charge.mock.calls as any)[0][1].codExternal).toBe(
      `pay_${(prisma.transaction.create.mock.calls as any)[0][0].data.id}_1`,
    );
    expect(
      (prisma.transaction.create.mock.calls as any)[0][0].data.amount,
    ).toEqual(new Prisma.Decimal('123.45'));
  });

  test('Frendz receives cents without silently selecting DOM', async () => {
    const { service, charge, gateways } = fixture('FRENDZ');
    await service.create({ ...context, acquirer: 'FRENDZ' }, input);
    expect((charge.mock.calls as any)[0][1].amount).toBe(12345);
    expect(gateways.byAcquirer).toHaveBeenCalledWith('FRENDZ');
  });

  test('routes PIX to cheapest active credentialed gateway and snapshots its cost', async () => {
    const { service, platform, prisma, gateways } = fixture();
    platform.integrations.push({
      key: 'FRENDZ_TOKEN',
      encryptedValue: encryptPlatformSecret('frendz-token'),
    });
    prisma.acquirerCatalogue.findMany.mockResolvedValue([
      { code: 'DOM', active: true },
      { code: 'FRENDZ', active: true },
    ]);
    prisma.acquirerFeeSchedule.findMany.mockResolvedValue([
      {
        id: 'dom',
        acquirerCode: 'DOM',
        fixedCents: 100,
        ratePpm: 50000,
        interestPpm: 0,
        base: 'ORIGINAL',
        source: 'manual',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'frendz',
        acquirerCode: 'FRENDZ',
        fixedCents: 50,
        ratePpm: 10000,
        interestPpm: 0,
        base: 'ORIGINAL',
        source: 'manual',
        createdAt: new Date('2026-01-01'),
      },
    ]);
    await service.create(context, input);
    expect(gateways.byAcquirer).toHaveBeenCalledWith('FRENDZ');
    const row = (prisma.transaction.create.mock.calls as any)[0][0].data;
    expect(row.acquirer).toBe('FRENDZ');
    expect(row.financialSnapshot.acquirerCost).toMatchObject({
      acquirer: 'FRENDZ',
      realizedCents: 173,
    });
  });

  test('inactive catalogue gateway fails closed before reserve', async () => {
    const { service, prisma, charge } = fixture();
    prisma.acquirerCatalogue.findMany.mockResolvedValue([
      { code: 'DOM', active: false },
    ]);
    await expect(service.create(context, input)).rejects.toMatchObject({
      status: 422,
    });
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  test('same key replays stored payment without another attempt or charge', async () => {
    const { service, charge, attempts, breaker } = fixture();
    const result = await service.create(context, input);
    expect(await service.create(context, input)).toEqual(result);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(attempts.reserve).toHaveBeenCalledTimes(1);
    expect(breaker.begin).toHaveBeenCalledTimes(1);
    await expect(
      service.create(context, { ...input, amountCents: 12346 }),
    ).rejects.toThrow();
    expect(charge).toHaveBeenCalledTimes(1);
    expect(attempts.reserve).toHaveBeenCalledTimes(1);
  });

  test('corporate contract without adapter cannot silently fall back to generic payment', async () => {
    const { service, platform, charge, prisma } = fixture();
    platform.tag = 'CONTROLE-MOTORISTA';
    await expect(
      service.create({ ...context, tag: 'CONTROLE-MOTORISTA' }, input),
    ).rejects.toMatchObject({ status: 422 });
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('ownership change and inactive owners block writes', async () => {
    const { service, platform, charge, prisma } = fixture();
    platform.ownerUserId = 'new-owner';
    await expect(service.create(context, input)).rejects.toThrow();
    platform.ownerUserId = 'owner';
    platform.owner.isActive = false;
    await expect(service.create(context, input)).rejects.toThrow();
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('unknown method and invalid cents never create a draft or charge', async () => {
    const { service, charge, prisma } = fixture();
    await expect(
      service.create(context, {
        ...input,
        paymentMethod: 'CREDIT_CARD' as never,
      }),
    ).rejects.toThrow();
    await expect(
      service.create(context, { ...input, amountCents: 1.5 }),
    ).rejects.toThrow();
    expect(charge).not.toHaveBeenCalled();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  test('open circuit before dispatch tries another provider with a distinct reference', async () => {
    const f = fixture();
    allowFallback(f);
    f.breaker.begin.mockImplementation(
      async (provider: string, operation: string) => {
        if (provider === 'DOM')
          throw new CircuitOpenException(provider, operation);
        return {
          provider,
          operation,
          token: 'fallback-permit',
          fence: 1n,
          probe: false,
        };
      },
    );
    const result = await f.service.create(context, input);
    expect(result.paymentId).toBe('gateway-payment');
    expect(f.attempts.reserve).toHaveBeenCalledTimes(2);
    expect(f.attempts.markReservedPreDispatchFailed).toHaveBeenCalledTimes(1);
    expect(f.attempts.claimDispatch).toHaveBeenCalledTimes(1);
    expect(f.gateways.byAcquirer).toHaveBeenCalledWith('FRENDZ');
    expect((f.charge.mock.calls as any)[0][1]).toMatchObject({
      codExternal: `pay_${(f.prisma.transaction.create.mock.calls as any)[0][0].data.id}_2`,
      amount: 12345,
    });
    expect(f.breaker.complete).toHaveBeenCalledTimes(1);
    expect(await f.service.create(context, input)).toEqual(result);
    expect(f.attempts.reserve).toHaveBeenCalledTimes(2);
  });

  test('fallback snapshots actual provider cost without repricing buyer or settlement', async () => {
    const baseline = fixture();
    allowFallback(baseline);
    const fallback = fixture();
    allowFallback(fallback);
    for (const f of [baseline, fallback]) {
      f.prisma.acquirerFeeSchedule.findMany.mockResolvedValue([
        {
          id: 'dom-fee',
          acquirerCode: 'DOM',
          fixedCents: 80,
          ratePpm: 10000,
          interestPpm: 0,
          base: 'ORIGINAL',
          source: 'manual',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'frendz-fee',
          acquirerCode: 'FRENDZ',
          fixedCents: 150,
          ratePpm: 30000,
          interestPpm: 0,
          base: 'ORIGINAL',
          source: 'manual',
          createdAt: new Date('2026-01-01'),
        },
      ]);
    }
    fallback.breaker.begin.mockImplementation(
      async (provider: string, operation: string) => {
        if (provider === 'DOM')
          throw new CircuitOpenException(provider, operation);
        return {
          provider,
          operation,
          token: 'fallback-permit',
          fence: 1n,
          probe: false,
        };
      },
    );
    const original = await baseline.service.create(context, input);
    const actual = await fallback.service.create(context, input);
    const before = (baseline.prisma.transaction.create.mock.calls as any)[0][0]
      .data;
    const fallbackDraft = (
      fallback.prisma.transaction.create.mock.calls as any
    )[0][0].data;
    expect(actual).toMatchObject({
      amountCents: original.amountCents,
      netAmountCents: original.netAmountCents,
    });
    expect(fallbackDraft.amount).toEqual(before.amount);
    expect(fallbackDraft.netAmount).toEqual(before.netAmount);
    expect(fallbackDraft.settlementBasis).toEqual(before.settlementBasis);
    expect(fallbackDraft.financialSnapshot.originalCents).toBe(
      before.financialSnapshot.originalCents,
    );
    expect(fallbackDraft.financialSnapshot.acquirerCost).toMatchObject({
      acquirer: 'DOM',
      realizedCents: 203,
    });
    const persisted = (await fallback.prisma.transaction.findUnique({})) as any;
    expect(persisted).toMatchObject({ acquirer: 'FRENDZ' });
    expect(persisted.amount).toEqual(before.amount);
    expect(persisted.netAmount).toEqual(before.netAmount);
    expect(persisted.settlementBasis).toEqual(before.settlementBasis);
    expect(persisted.financialSnapshot).toMatchObject({
      originalCents: before.financialSnapshot.originalCents,
      acquirerCost: {
        acquirer: 'FRENDZ',
        fixedCents: 150,
        ratePpm: 30000,
        realizedCents: 520,
      },
    });
    expect((fallback.charge.mock.calls as any)[0][1].amount).toBe(
      (baseline.charge.mock.calls as any)[0][1].amount * 100,
    );
  });

  test('failed reserved-to-pre-dispatch CAS stops fallback without dispatch', async () => {
    const f = fixture();
    allowFallback(f);
    f.breaker.begin.mockRejectedValue(
      new CircuitOpenException('DOM', 'CREATE_PIX'),
    );
    f.attempts.markReservedPreDispatchFailed.mockResolvedValue(false);
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    expect(f.attempts.markReservedPreDispatchFailed).toHaveBeenCalledTimes(1);
    expect(f.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(f.attempts.claimDispatch).not.toHaveBeenCalled();
    expect(f.charge).not.toHaveBeenCalled();
  });

  test('unavailable circuit fails closed without trying another provider', async () => {
    const f = fixture();
    allowFallback(f);
    f.breaker.begin.mockRejectedValue(new CircuitUnavailableException());
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      status: 503,
    });
    expect(f.attempts.markReservedPreDispatchFailed).toHaveBeenCalledTimes(1);
    expect(f.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(f.charge).not.toHaveBeenCalled();
  });

  test('verified no-charge rejection permits fallback but keeps the original financial amount', async () => {
    const f = fixture();
    allowFallback(f);
    f.charge.mockImplementationOnce(async () => {
      throw markDefinitiveDomRejection(new Error('verified no charge'));
    });
    expect(await f.service.create(context, input)).toMatchObject({
      paymentId: 'gateway-payment',
      amountCents: input.amountCents,
    });
    expect(f.attempts.markPreCreationFailed).toHaveBeenCalledTimes(1);
    expect(f.attempts.reserve).toHaveBeenCalledTimes(2);
    expect(f.charge).toHaveBeenCalledTimes(2);
    const calls = f.charge.mock.calls as any;
    expect(calls[0][1]).toMatchObject({ amount: 123.45 });
    expect(calls[1][1]).toMatchObject({ amount: 12345 });
    expect(calls[0][1].codExternal).not.toBe(calls[1][1].codExternal);
    expect(
      (f.prisma.transaction.create.mock.calls as any)[0][0].data.amount,
    ).toEqual(new Prisma.Decimal('123.45'));
  });

  test('failed provider-response CAS never marks the draft paid or retries', async () => {
    const f = fixture();
    allowFallback(f);
    f.attempts.recordProviderResponse.mockResolvedValue(false);
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    expect(f.attempts.recordProviderResponse).toHaveBeenCalledTimes(1);
    expect(f.prisma.transaction.updateMany).not.toHaveBeenCalled();
    expect(f.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(f.charge).toHaveBeenCalledTimes(1);
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    expect(f.charge).toHaveBeenCalledTimes(1);
  });

  test('ambiguous gateway failure blocks fallback and idempotent retry', async () => {
    const f = fixture();
    allowFallback(f);
    f.charge.mockImplementation(async () => {
      throw new Error('timeout');
    });
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    await expect(f.service.create(context, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    expect(f.attempts.markUnknown).toHaveBeenCalledTimes(1);
    expect(f.attempts.markPreCreationFailed).not.toHaveBeenCalled();
    expect(f.attempts.reserve).toHaveBeenCalledTimes(1);
    expect(f.charge).toHaveBeenCalledTimes(1);
  });
});

const nativeFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = nativeFetch;
});
const cardInput = {
  ...input,
  paymentMethod: 'CREDIT_CARD' as const,
  card: {
    token: 'mock-card-token',
    holderName: 'Maria Silva',
    bin: '424242',
    brand: 'visa',
    installments: 2,
  },
};

describe('canonical card acquirer', () => {
  test('DOM receives reais, persists no token, and replays without charging twice', async () => {
    const { service, prisma } = fixture();
    const transport = mock(async () =>
      Response.json({ id: 'card-payment', status: 'paid' }),
    );
    globalThis.fetch = transport as never;
    const result = await service.create(context, cardInput);
    expect(result.status).toBe('PENDING');
    expect(
      JSON.parse((transport.mock.calls as any)[0][1].body).payment,
    ).toMatchObject({ total: 123.45, credit_card: { installments: 2 } });
    expect(JSON.stringify(prisma.transaction.create.mock.calls)).not.toContain(
      'mock-card-token',
    );
    const stored = (prisma.transaction.create.mock.calls as any)[0][0].data;
    expect(stored.description).not.toContain('[REQUEST:');
    expect(stored.tracking.cardRequestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(await service.create(context, cardInput)).toEqual(result);
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(
      service.create(context, {
        ...cardInput,
        card: { ...cardInput.card, token: 'other-token' },
      }),
    ).rejects.toThrow();
  });

  test('legacy card digest still validates replay and rejects changed card', async () => {
    const { service, prisma } = fixture();
    const transport = mock(async () =>
      Response.json({ id: 'card-payment', status: 'paid' }),
    );
    globalThis.fetch = transport as never;
    const result = await service.create(context, cardInput);
    const stored = (prisma.transaction.create.mock.calls as any)[0][0].data;
    await prisma.transaction.update({
      data: {
        description: `${stored.description} [REQUEST:${stored.tracking.cardRequestDigest}]`,
        tracking: {},
      },
    });
    expect(await service.create(context, cardInput)).toEqual(result);
    await expect(
      service.create(context, {
        ...cardInput,
        card: { ...cardInput.card, installments: 3 },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test('unsupported Frendz card fails before draft and never switches to DOM', async () => {
    const { service, prisma, gateways } = fixture('FRENDZ');
    await expect(
      service.create({ ...context, acquirer: 'FRENDZ' }, cardInput),
    ).rejects.toThrow();
    expect(prisma.transaction.create).not.toHaveBeenCalled();
    expect(gateways.byAcquirer).not.toHaveBeenCalled();
  });

  test('uncertain card transport failure retains draft and never charges retry', async () => {
    const { service } = fixture();
    const transport = mock(async () => {
      throw new Error('timeout');
    });
    globalThis.fetch = transport as never;
    await expect(service.create(context, cardInput)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    await expect(service.create(context, cardInput)).rejects.toMatchObject({
      response: { code: 'PAYMENT_PROCESSING' },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  test('rejection is persisted and cannot become an approved response', async () => {
    const { service } = fixture();
    globalThis.fetch = mock(async () =>
      Response.json({ id: 'declined-card', status: 'not_authorized' }),
    ) as never;
    expect(await service.create(context, cardInput)).toMatchObject({
      status: 'FAILED',
      paymentId: 'declined-card',
    });
  });

  test('webhook completion during charge cannot regress to pending', async () => {
    const { service, prisma } = fixture();
    globalThis.fetch = mock(async () => {
      await prisma.transaction.update({ data: { status: 'COMPLETED' } });
      return Response.json({ id: 'immediate-payment', status: 'paid' });
    }) as never;
    expect((await service.create(context, cardInput)).status).toBe('COMPLETED');
  });
});

test('merchant payments snapshot the platform owner without changing the beneficiary wallet', async () => {
  const { service, prisma: base } = fixture();
  const prisma = base as typeof base & { integrationMerchant: unknown };
  prisma.integrationMerchant = {
    findUnique: mock(async () => ({
      id: 'merchant',
      userId: 'seller',
      user: { isActive: true, isPurged: false },
    })),
  } as never;
  await service.createForMerchant(context, 'external-merchant', input);
  expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
    userId: 'seller',
    tracking: {
      reportAttribution: {
        platformId: 'platform',
        ownerUserId: 'owner',
        beneficiaryUserId: 'seller',
      },
    },
  });
});

test('canonical Delivery allocation charges exact total, freezes shares and rejects replay changes', async () => {
  const f = fixture();
  const delegated = {
    id: 'credential',
    source: 'delivery',
    platformId: 'platform',
    merchantId: 'merchant',
    externalCompanyId: 'company',
    isActive: true,
    profile: {
      code: 'DELIVERY',
      isActive: true,
      acquirer: 'DOM',
      encryptedCredential: encryptPlatformSecret('delivery-account'),
    },
  };
  const p = f.prisma as any;
  p.platformApiCredential = { findUnique: async () => delegated };
  p.integrationMerchant = {
    findUnique: async () => ({
      id: 'merchant',
      userId: 'seller',
      user: { isActive: true, isPurged: false },
    }),
  };
  const ctx = {
    ...context,
    delivery: {
      credentialId: 'credential',
      merchantId: 'merchant',
      externalCompanyId: 'company',
      profileId: 'profile',
      allocate: true,
    },
  };
  const request = {
    ...input,
    amountCents: 10537,
    allocation: { merchantAmountCents: 10000, platformFeeCents: 537 },
  };
  expect(
    await f.service.createForMerchant(ctx, 'company', request),
  ).toMatchObject({ amountCents: 10537, netAmountCents: 10000 });
  expect((f.charge.mock.calls as any)[0][0]).toBe('delivery-account');
  expect((f.charge.mock.calls as any)[0][1].amount).toBe(105.37);
  const row = (f.prisma.transaction.create.mock.calls as any)[0][0].data;
  expect(row.financialSnapshot).toMatchObject({
    contract: 'SIM_DELIVERY_ALLOCATION_V1',
    totalAmountCents: 10537,
    merchantAmountCents: 10000,
    platformFeeCents: 537,
  });
  expect(row.tracking.delivery).toMatchObject({
    credentialId: 'credential',
    idempotencyKey: input.idempotencyKey,
  });
  expect(f.prisma.financialPolicyRevision.findMany).not.toHaveBeenCalled();
  await f.service.createForMerchant(ctx, 'company', request);
  const withoutAllocation = { ...request, allocation: undefined };
  await expect(
    f.service.createForMerchant(ctx, 'company', withoutAllocation),
  ).rejects.toMatchObject({
    status: 422,
    response: { code: 'DELIVERY_ALLOCATION_REQUIRED' },
  });
  await expect(
    f.service.createForMerchant(ctx, 'company', {
      ...request,
      allocation: { merchantAmountCents: 10001, platformFeeCents: 536 },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(f.charge).toHaveBeenCalledTimes(1);
});
test('ordinary canonical callers cannot override the financial allocation', async () => {
  const f = fixture();
  await expect(
    f.service.create(context, {
      ...input,
      allocation: { merchantAmountCents: 12000, platformFeeCents: 345 },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(f.charge).not.toHaveBeenCalled();
});
test('platform defaults freeze item-only distribution, reject missing base and preserve replay after edits', async () => {
  const f = fixture();
  (f.prisma as any).integrationMerchant = {
    findUnique: async () => ({
      id: 'merchant',
      externalMerchantId: 'company',
      userId: 'seller',
      user: { isActive: true, isPurged: false },
    }),
  };
  (f.prisma as any).platformApiCredential = {
    findUnique: async () => ({
      id: 'credential',
      platformId: 'platform',
      merchantId: 'merchant',
      externalCompanyId: 'company',
      source: 'delivery',
      isActive: true,
      profile: {
        code: 'DELIVERY',
        isActive: true,
        acquirer: 'DOM',
        encryptedCredential: encryptPlatformSecret('mock-token'),
      },
    }),
  };
  f.prisma.$queryRaw.mockResolvedValue([
    {
      mode: 'OWN',
      version: 1,
      participants: [{ userId: 'partner', percentageBps: 500 }],
    },
  ]);
  const ctx = {
    ...context,
    delivery: {
      credentialId: 'credential',
      merchantId: 'merchant',
      externalCompanyId: 'company',
      profileId: 'profile',
      allocate: true,
    },
  };
  const request = {
    ...input,
    amountCents: 11537,
    allocation: { merchantAmountCents: 11000, platformFeeCents: 537 },
  };
  await expect(
    f.service.createForMerchant(ctx, 'company', request),
  ).rejects.toMatchObject({ status: 422 });
  expect(f.charge).not.toHaveBeenCalled();
  expect(f.prisma.transaction.create).not.toHaveBeenCalled();
  const withItems = {
    ...request,
    allocation: {
      ...request.allocation,
      itemsAmountCents: 10000,
      deliveryAmountCents: 1000,
    },
  };
  await f.service.createForMerchant(ctx, 'company', withItems);
  const saved = (f.prisma.transaction.create.mock.calls as any)[0][0].data;
  expect(saved.netAmount.toNumber()).toBe(110);
  expect(saved.platformFee.toNumber()).toBe(5.37);
  expect(saved.financialSnapshot.coproduction).toMatchObject({
    baseCents: 10000,
    version: 1,
    ownerUserId: 'seller',
  });
  f.prisma.$queryRaw.mockResolvedValue([
    { mode: 'OWN', version: 2, participants: [] },
  ]);
  await f.service.createForMerchant(ctx, 'company', withItems);
  expect(f.charge).toHaveBeenCalledTimes(1);
  await expect(
    f.service.createForMerchant(ctx, 'company', {
      ...withItems,
      allocation: {
        ...withItems.allocation,
        itemsAmountCents: 9999,
        deliveryAmountCents: 1001,
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
});
