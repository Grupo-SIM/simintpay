import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PlatformVoucherCapabilitiesService } from './platform-voucher-capabilities.service';
import type { PlatformContext } from './platform-context.service';

function fixture() {
  const context: PlatformContext = { id: 'platform', tag: 'PAGATG', ownerUserId: 'owner', acquirer: 'DOM' };
  const voucher = { id: 'voucher', code: 'OFF', discountType: 'PERCENTAGE', discountValue: 10, isActive: true };
  const findMany = mock(async (_: unknown) => [voucher]);
  const findFirst = mock(async (_: unknown) => voucher as typeof voucher | null);
  const createVoucher = mock(async (_user: string, _dto: unknown) => voucher);
  const validateVoucher = mock(async (_user: string, _dto: unknown) => ({ valid: true, voucherId: 'voucher', code: 'OFF', discountAmount: 1.23, finalAmount: 11.11 }));
  const deleteVoucher = mock(async (_user: string, _role: string, _id: string) => ({ deleted: true }));
  const resolve = mock(async () => ({ ...context }));
  const service = new PlatformVoucherCapabilitiesService({ voucher: { findMany, findFirst } } as never,
    { resolve } as never, { get: () => ({ createVoucher, validateVoucher, deleteVoucher }) } as never);
  return { service, context, resolve, findFirst, findMany, createVoucher, validateVoucher, deleteVoucher };
}

describe('Pagatg voucher canonical contracts', () => {
  test('forces current owner/channel and converts decimal rate to legacy percentage', async () => {
    const f = fixture();
    const result = await f.service.create(f.context, { code: 'OFF', discountType: 'PERCENTAGE', discountRate: 0.1, userId: 'other', allowedChannels: ['OTHER'] } as never);
    expect(f.createVoucher).toHaveBeenCalledWith('owner', { code: 'OFF', description: undefined, discountType: 'PERCENTAGE', discountValue: 10, maxUsage: undefined, allowedChannels: ['PAGATG'] });
    expect(result.discountRate).toBe(0.1);
    expect(result).not.toHaveProperty('discountValue');
  });
  test('converts fixed cents to reais exactly once', async () => {
    const f = fixture();
    f.createVoucher.mockResolvedValueOnce({ id: 'voucher', code: 'OFF', discountType: 'FIXED', discountValue: 12.34, isActive: true });
    expect(await f.service.create(f.context, { code: 'OFF', discountType: 'FIXED', discountAmountCents: 1234 })).toMatchObject({ discountAmountCents: 1234 });
    expect(f.createVoucher.mock.calls[0][1]).toMatchObject({ discountValue: 12.34 });
    await expect(f.service.create(f.context, { code: 'OFF', discountType: 'FIXED', discountAmountCents: 1.2 })).rejects.toBeInstanceOf(BadRequestException);
  });
  test('listing isolates same-owner vouchers from other corporate platforms', async () => {
    const f = fixture();
    await f.service.list(f.context);
    expect(f.findMany).toHaveBeenCalledWith({ where: { userId: 'owner', allowedChannels: { has: 'PAGATG' } }, orderBy: { createdAt: 'desc' } });
  });
  test('validation strips resource and owner overrides before delegating', async () => {
    const f = fixture();
    expect(await f.service.validate(f.context, { code: 'OFF', amountCents: 1234, planId: 'other-plan', targetOwnerId: 'other' } as never)).toEqual({ valid: true, voucherId: 'voucher', code: 'OFF', originalAmountCents: 1234, discountAmountCents: 123, finalAmountCents: 1111 });
    expect(f.validateVoucher).toHaveBeenCalledWith('owner', { code: 'OFF', amount: 12.34, channel: 'PAGATG' });
    f.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.validate(f.context, { code: 'OTHER', amountCents: 100 })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.validateVoucher).toHaveBeenCalledTimes(1);
  });
  test('deletion requires owned Pagatg voucher before calling existing service', async () => {
    const f = fixture();
    await f.service.delete(f.context, 'voucher');
    expect(f.deleteVoucher).toHaveBeenCalledWith('owner', 'USER', 'voucher');
    f.findFirst.mockResolvedValueOnce(null);
    await expect(f.service.delete(f.context, 'other')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.deleteVoucher).toHaveBeenCalledTimes(1);
  });
  test('unsupported platform and stale transferred context reject all work', async () => {
    const f = fixture(); f.context.tag = 'OTHER';
    await expect(f.service.list(f.context)).rejects.toBeInstanceOf(UnprocessableEntityException);
    f.context.tag = 'PAGATG'; f.resolve.mockResolvedValueOnce({ ...f.context, ownerUserId: 'new-owner' });
    await expect(f.service.list(f.context)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.findMany).not.toHaveBeenCalled();
  });
});
