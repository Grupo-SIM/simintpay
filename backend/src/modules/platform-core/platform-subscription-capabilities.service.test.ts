import { describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlatformSubscriptionCapabilitiesService } from './platform-subscription-capabilities.service';
import type { PlatformContext } from './platform-context.service';

function fixture(tag = 'PAGATG') {
  const context: PlatformContext = {
    id: 'platform',
    tag,
    ownerUserId: 'current-owner',
    acquirer: 'DOM',
  };
  const execute = mock(async (..._args: unknown[]) => ({
    id: 'link',
    code: 'code',
    name: 'Plan',
    amountCents: 1234,
    isActive: true,
  }));
  const findFirst = mock(async () => ({ id: 'link' }) as { id: string } | null);
  const findOrder = mock(async () => ({
    createdAt: new Date('2026-01-01'),
  }));
  const prisma = {
    subscriptionLink: { findFirst },
    subscriptionLinkOrder: { findFirst: findOrder },
  };
  const resolve = mock(async () => ({ ...context }));
  const service = new PlatformSubscriptionCapabilitiesService(
    prisma as never,
    { resolve } as never,
    { get: () => ({ create: execute }) } as never,
  );
  return { service, context, execute, findFirst, findOrder, resolve };
}

describe('corporate subscription capabilities', () => {
  test('Pagatg delegates plan creation to shared subscription use case using current owner and explicit platform', async () => {
    const f = fixture();
    const result = await f.service.createPlan(f.context, {
      name: 'Plan',
      amountCents: 1234,
      frequency: 'MENSAL',
      userId: 'attacker',
      email: 'attacker@example.com',
    } as never);
    expect(f.execute).toHaveBeenCalledWith(
      { id: 'current-owner', role: 'USER' },
      expect.objectContaining({
        kind: 'SUBSCRIPTION_LINK',
        name: 'Plan',
        amountCents: 1234,
        platformTag: 'PAGATG',
        ownerUserId: 'current-owner',
      }),
    );
    expect(result.amountCents).toBe(1234);
    expect(result).not.toHaveProperty('valor');
  });
  test('unsupported platform and acquirer reject before calling gateway use case', async () => {
    const f = fixture('OTHER');
    await expect(
      f.service.createPlan(f.context, {
        name: 'Plan',
        amountCents: 100,
        frequency: 'MENSAL',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(f.execute).not.toHaveBeenCalled();
    f.context.tag = 'PAGATG';
    f.context.acquirer = 'FRENDZ';
    await expect(
      f.service.createPlan(f.context, {
        name: 'Plan',
        amountCents: 100,
        frequency: 'MENSAL',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(f.execute).not.toHaveBeenCalled();
  });
  test('owner transfer invalidates stale authenticated write context', async () => {
    const f = fixture();
    f.resolve.mockResolvedValueOnce({ ...f.context, ownerUserId: 'new-owner' });
    await expect(
      f.service.createPlan(f.context, {
        name: 'Plan',
        amountCents: 100,
        frequency: 'MENSAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.execute).not.toHaveBeenCalled();
  });
});

describe('paymentStatus through Offer ', () => {
  const run = async (charge: { createdAt: Date } | null) => {
    {
      const context: PlatformContext = {
        id: 'platform',
        tag: 'PAGATG',
        ownerUserId: 'owner',
        acquirer: 'DOM',
      };
      const offerFind = mock<(arg: unknown) => Promise<any>>(async () => ({
        id: 'offer-1',
      }));
      const chargeFind = mock<(arg: unknown) => Promise<any>>(
        async () => charge,
      );
      const service = new PlatformSubscriptionCapabilitiesService(
        {
          offer: { findFirst: offerFind },
          charge: { findFirst: chargeFind },
        } as never,
        { resolve: async () => ({ ...context }) } as never,
        {} as never,
      );
      const result = await service.paymentStatus(context, 'code');
      return { result, offerFind, chargeFind };
    }
  };

  test('paid cycle is a PAID charge of the platform offer', async () => {
    const paidAt = new Date('2026-02-02');
    const { result, offerFind } = await run({ createdAt: paidAt });
    expect(result).toEqual({ paid: true, paidAt });
    expect((offerFind.mock.calls[0][0] as any).where).toMatchObject({
      code: 'code',
      ownerUserId: 'owner',
      platformTag: 'PAGATG',
    });
  });

  test('no paid charge reports unpaid', async () => {
    expect((await run(null)).result).toEqual({ paid: false, paidAt: null });
  });
});
