/* eslint-disable @typescript-eslint/no-unused-vars -- typed mock signatures keep call arguments inspectable */
import { describe, expect, mock, test } from 'bun:test';
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PlatformVoucherCapabilitiesService } from './platform-voucher-capabilities.service';
import type { PlatformContext } from './platform-context.service';

function fixture() {
  const context: PlatformContext = {
    id: 'platform',
    tag: 'PAGATG',
    ownerUserId: 'owner',
    acquirer: 'DOM',
  };
  const voucher = {
    id: 'voucher',
    code: 'OFF',
    discountType: 'PERCENTAGE',
    discountValue: 10,
    isActive: true,
  };
  const findMany = mock(async (_: unknown) => [voucher]);
  const findFirst = mock(
    async (_: unknown) => voucher as typeof voucher | null,
  );
  const createVoucher = mock(async (_user: string, _dto: unknown) => voucher);
  const validateVoucher = mock(async (_user: string, _dto: unknown) => ({
    valid: true,
    voucherId: 'voucher',
    code: 'OFF',
    discountAmount: 1.23,
    finalAmount: 11.11,
  }));
  const deleteVoucher = mock(
    async (_user: string, _role: string, _id: string) => ({ deleted: true }),
  );
  const resolve = mock(async () => ({ ...context }));
  const offers = [
    { id: 'offer-1', code: 'OFFER1', ownerUserId: 'owner' },
    { id: 'offer-2', code: 'OFFER2', ownerUserId: 'stranger' },
  ];
  const offerFindMany = mock(
    async (args: { where: { ownerUserId: string; code: { in: string[] } } }) =>
      offers.filter(
        (o) =>
          o.ownerUserId === args.where.ownerUserId &&
          args.where.code.in.includes(o.code),
      ),
  );
  const offerFindUnique = mock(
    async (args: { where: { code?: string; id?: string } }) =>
      offers.find(
        (o) => o.code === args.where.code || o.id === args.where.id,
      ) ?? null,
  );
  const validateForOffer = mock(
    async (_offer: unknown, _code: string, amountCents: number) => ({
      valid: true,
      voucherId: 'voucher',
      code: 'OFF',
      originalAmountCents: amountCents,
      discountAmountCents: 100,
      finalAmountCents: amountCents - 100,
    }),
  );
  const service = new PlatformVoucherCapabilitiesService(
    {
      voucher: { findMany, findFirst },
      offer: { findMany: offerFindMany, findUnique: offerFindUnique },
    } as never,
    { resolve } as never,
    {
      get: () => ({
        createVoucher,
        validateVoucher,
        deleteVoucher,
        validateForOffer,
        updateVoucher: createVoucher,
      }),
    } as never,
  );
  return {
    service,
    context,
    resolve,
    findFirst,
    findMany,
    createVoucher,
    validateVoucher,
    deleteVoucher,
    validateForOffer,
  };
}

describe('Pagatg voucher canonical contracts', () => {
  test('forces current owner/channel and converts decimal rate to legacy percentage', async () => {
    const f = fixture();
    const result = await f.service.create(f.context, {
      code: 'OFF',
      discountType: 'PERCENTAGE',
      discountRate: 0.1,
      userId: 'other',
      allowedChannels: ['OTHER'],
    } as never);
    expect(f.createVoucher).toHaveBeenCalledWith('owner', {
      code: 'OFF',
      description: undefined,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      maxUsage: undefined,
      allowedChannels: ['PAGATG'],
    });
    expect(result.discountRate).toBe(0.1);
    expect(result).not.toHaveProperty('discountValue');
  });
  test('converts fixed cents to reais exactly once', async () => {
    const f = fixture();
    f.createVoucher.mockResolvedValueOnce({
      id: 'voucher',
      code: 'OFF',
      discountType: 'FIXED',
      discountValue: 12.34,
      isActive: true,
    });
    expect(
      await f.service.create(f.context, {
        code: 'OFF',
        discountType: 'FIXED',
        discountAmountCents: 1234,
      }),
    ).toMatchObject({ discountAmountCents: 1234 });
    expect(f.createVoucher.mock.calls[0][1]).toMatchObject({
      discountValue: 12.34,
    });
    await expect(
      f.service.create(f.context, {
        code: 'OFF',
        discountType: 'FIXED',
        discountAmountCents: 1.2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  test('listing isolates same-owner vouchers from other corporate platforms', async () => {
    const f = fixture();
    await f.service.list(f.context);
    expect(f.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner', allowedChannels: { has: 'PAGATG' } },
      orderBy: { createdAt: 'desc' },
    });
  });
  test('validation strips resource and owner overrides before delegating', async () => {
    const f = fixture();
    expect(
      await f.service.validate(f.context, {
        code: 'OFF',
        amountCents: 1234,
        planId: 'other-plan',
        targetOwnerId: 'other',
      } as never),
    ).toEqual({
      valid: true,
      voucherId: 'voucher',
      code: 'OFF',
      originalAmountCents: 1234,
      discountAmountCents: 123,
      finalAmountCents: 1111,
    });
    expect(f.validateVoucher).toHaveBeenCalledWith('owner', {
      code: 'OFF',
      amount: 12.34,
      channel: 'PAGATG',
    });
    f.findFirst.mockResolvedValueOnce(null);
    await expect(
      f.service.validate(f.context, { code: 'OTHER', amountCents: 100 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.validateVoucher).toHaveBeenCalledTimes(1);
  });
  test('deletion requires owned Pagatg voucher before calling existing service', async () => {
    const f = fixture();
    await f.service.delete(f.context, 'voucher');
    expect(f.deleteVoucher).toHaveBeenCalledWith('owner', 'USER', 'voucher');
    f.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.delete(f.context, 'other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(f.deleteVoucher).toHaveBeenCalledTimes(1);
  });
  test('unsupported platform and stale transferred context reject all work', async () => {
    const f = fixture();
    f.context.tag = 'OTHER';
    await expect(f.service.list(f.context)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    f.context.tag = 'PAGATG';
    f.resolve.mockResolvedValueOnce({ ...f.context, ownerUserId: 'new-owner' });
    await expect(f.service.list(f.context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(f.findMany).not.toHaveBeenCalled();
  });
});

describe('Pagatg vouchers on offers', () => {
  test('create restricts the voucher to offers of the current owner', async () => {
    const f = fixture();
    await f.service.create(f.context, {
      code: 'OFF',
      discountType: 'PERCENTAGE',
      discountRate: 0.1,
      offerCodes: ['OFFER1'],
    });
    expect(f.createVoucher.mock.calls[0][1]).toMatchObject({
      allowedLinkCodes: ['OFFER1'],
      allowedChannels: ['PAGATG'],
    });
    await expect(
      f.service.create(f.context, {
        code: 'OFF',
        discountType: 'PERCENTAGE',
        discountRate: 0.1,
        offerCodes: ['OFFER2'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(f.createVoucher).toHaveBeenCalledTimes(1);
  });
  test('update accepts offerCodes under the same ownership rule', async () => {
    const f = fixture();
    await f.service.update(f.context, 'voucher', { offerCodes: ['OFFER1'] });
    expect(f.createVoucher.mock.calls[0][3]).toMatchObject({
      allowedLinkCodes: ['OFFER1'],
      allowedChannels: ['PAGATG'],
    });
    await expect(
      f.service.update(f.context, 'voucher', { offerCodes: ['OFFER2'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  test('validate with offerCode uses the offer rules in cents; foreign offers are not found', async () => {
    const f = fixture();
    expect(
      await f.service.validate(f.context, {
        code: 'OFF',
        amountCents: 1000,
        offerCode: 'OFFER1',
      }),
    ).toEqual({
      valid: true,
      voucherId: 'voucher',
      code: 'OFF',
      originalAmountCents: 1000,
      discountAmountCents: 100,
      finalAmountCents: 900,
      offerCode: 'OFFER1',
    });
    expect(f.validateForOffer.mock.calls[0][1]).toBe('OFF');
    expect(f.validateVoucher).not.toHaveBeenCalled();
    await expect(
      f.service.validate(f.context, {
        code: 'OFF',
        amountCents: 1000,
        offerCode: 'OFFER2',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.validateForOffer).toHaveBeenCalledTimes(1);
  });
});
