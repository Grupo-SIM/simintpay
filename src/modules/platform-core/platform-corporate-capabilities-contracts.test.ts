import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformBetaiController, PlatformBetaiBillDto } from './platform-betai.controller';
import { PlatformAuthGuard } from './platform-auth.guard';
import { PlatformSubscriptionCapabilitiesController } from './platform-subscription-capabilities.controller';
import { PlatformVoucherCapabilitiesController } from './platform-voucher-capabilities.controller';
import { PlatformSubscriptionPlanDto } from './platform-subscription-capabilities.dto';
import { PlatformVoucherDto, PlatformVoucherUpdateDto } from './platform-voucher.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('canonical corporate capability authorization contracts', () => {
  test('all controllers require platform auth and declare explicit operation scopes', () => {
    for (const [controller, scopes] of [
      [PlatformBetaiController, { create: 'billing:write', status: 'billing:read', cancel: 'subscriptions:write' }],
      [PlatformSubscriptionCapabilitiesController, { create: 'subscriptions:write', status: 'subscriptions:read', access: 'subscriptions:read' }],
      [PlatformVoucherCapabilitiesController, { list: 'vouchers:read', create: 'vouchers:write', validate: 'vouchers:read', update: 'vouchers:write', delete: 'vouchers:write' }],
    ] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(PlatformAuthGuard);
      for (const [method, scope] of Object.entries(scopes)) {
        expect(Reflect.getMetadata('platform-operation', (controller.prototype as unknown as Record<string, object>)[method])).toBe(scope);
      }
    }
  });
  test('billing DTO rejects fractional cents and owner overrides', async () => {
    expect(await validate(plainToInstance(PlatformBetaiBillDto, { amountCents: 1234 }), options)).toEqual([]);
    for (const input of [{ amountCents: 12.34 }, { amountCents: 1234, ownerUserId: 'other' }, { valor: 12.34 }]) {
      expect((await validate(plainToInstance(PlatformBetaiBillDto, input), options)).length).toBeGreaterThan(0);
    }
  });
  test('plan DTO rejects fractional cents, identity override and unsupported frequency', async () => {
    const valid = { name: 'Monthly', amountCents: 100, frequency: 'MENSAL' };
    expect(await validate(plainToInstance(PlatformSubscriptionPlanDto, valid), options)).toEqual([]);
    for (const input of [{ ...valid, amountCents: 1.5 }, { ...valid, amountCents: 0 }, { ...valid, userId: 'other' }, { ...valid, frequency: 'DAILY' }]) {
      expect((await validate(plainToInstance(PlatformSubscriptionPlanDto, input), options)).length).toBeGreaterThan(0);
    }
  });
  test('voucher DTO requires correct decimal or cents unit and rejects legacy ambiguity', async () => {
    expect(await validate(plainToInstance(PlatformVoucherDto, { code: 'OFF', discountType: 'PERCENTAGE', discountRate: 0.1 }), options)).toEqual([]);
    expect(await validate(plainToInstance(PlatformVoucherDto, { code: 'OFF', discountType: 'FIXED', discountAmountCents: 1234 }), options)).toEqual([]);
    for (const input of [
      { code: 'OFF', discountType: 'PERCENTAGE', discountRate: 10 },
      { code: 'OFF', discountType: 'PERCENTAGE' },
      { code: 'OFF', discountType: 'FIXED', discountAmountCents: 12.34 },
      { code: 'OFF', discountType: 'FIXED', discountAmountCents: 1, discountValue: 1 },
    ]) {
      expect((await validate(plainToInstance(PlatformVoucherDto, input), options)).length).toBeGreaterThan(0);
    }
  });
  test('voucher update DTO validates partial cents/rate and rejects identity/channel overrides', async () => {
    expect(await validate(plainToInstance(PlatformVoucherUpdateDto, { discountRate: 0.15, discountType: 'PERCENTAGE', isActive: false }), options)).toEqual([]);
    for (const input of [{ discountAmountCents: 1.2 }, { discountRate: 15 }, { isActive: 'false' }, { userId: 'other' }, { allowedChannels: ['OTHER'] }]) {
      expect((await validate(plainToInstance(PlatformVoucherUpdateDto, input), options)).length).toBeGreaterThan(0);
    }
  });
});
