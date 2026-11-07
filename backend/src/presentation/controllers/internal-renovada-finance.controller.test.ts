import 'reflect-metadata';
import { beforeEach, expect, test } from 'bun:test';
import { Reflector } from '@nestjs/core';
import { InternalRenovadaFinanceController } from './internal-renovada-finance.controller';
import { LegacyInternalAuthGuard } from '../../modules/platform-core/legacy-internal-auth.guard';
import {
  initializePlatformTaxasCache,
  readOverridesRaw,
} from '../../modules/platform-taxas/platform-taxas.store';

beforeEach(async () => {
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
    platform: { findMany: async () => [] },
  } as never);
});

test('withdrawal fees preserve global inheritance and explicit Renovada zero overrides', () => {
  const cache = readOverridesRaw();
  cache.GLOBAL = { TAXA_SAQUE_EXTRA: 5, TAXA_SAQUE_PERCENT: 1, SAQUE_MIN: 80 };
  cache.RENOVADA = { TAXA_SAQUE_EXTRA: 0 };
  cache.BOSQUE = { SAQUE_MIN: 999 };
  const controller = new InternalRenovadaFinanceController(undefined as never);
  expect(controller.fees()).toEqual({
    taxaFixa: 0,
    taxaPercent: 0,
    saqueMin: 80,
  });
});

test('fees route retains internal credential guard and Renovada identity', () => {
  expect(
    Reflect.getMetadata(
      'path',
      InternalRenovadaFinanceController.prototype.fees,
    ),
  ).toBe('fees');
  expect(
    Reflect.getMetadata('__guards__', InternalRenovadaFinanceController),
  ).toContain(LegacyInternalAuthGuard);
  expect(
    new Reflector().get(
      'legacy-platform-tag',
      InternalRenovadaFinanceController,
    ),
  ).toBe('RENOVADA');
});
