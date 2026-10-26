import 'reflect-metadata';
import { afterEach, beforeAll, expect, test } from 'bun:test';
import { Reflector } from '@nestjs/core';
import { LegacyInternalAuthGuard } from './legacy-internal-auth.guard';
import { initializePlatformIntegrationsCache } from '../platform-integrations/platform-integrations.store';

const original = { machine: process.env.API_MACHINE_INTERNAL_TOKEN, fallback: process.env.INTERNAL_SERVICE_TOKEN };
afterEach(() => {
  for (const [key, value] of [['API_MACHINE_INTERNAL_TOKEN', original.machine], ['INTERNAL_SERVICE_TOKEN', original.fallback]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});
beforeAll(async () => initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () =>
  ['EBOOK', 'BOSQUE', 'AREAFLIX'].map(tag => ({ platform: { tag }, key: 'INTERNAL_TOKEN', url: `${tag}-secret` })) } } as any));
function context(tag: string, token?: unknown, isPublic = false) {
  class Controller {}
  const handler = () => {};
  Reflect.defineMetadata('legacy-platform-tag', tag, Controller);
  if (isPublic) Reflect.defineMetadata('legacy-public', true, handler);
  return { getClass: () => Controller, getHandler: () => handler, switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-token': token } }) }) } as any;
}
for (const tag of ['EBOOK', 'BOSQUE', 'AREAFLIX', 'ATLAS', 'RENOVADA', 'PAGATG']) {
  test(`${tag} preserves legacy credential source and rejects foreign or missing credentials`, () => {
    process.env.API_MACHINE_INTERNAL_TOKEN = 'machine';
    const guard = new LegacyInternalAuthGuard(new Reflector());
    const expected = ['EBOOK', 'BOSQUE', 'AREAFLIX'].includes(tag) ? `${tag}-secret` : 'machine';
    expect(guard.canActivate(context(tag, expected))).toBe(true);
    for (const token of [undefined, '', 'foreign', [expected]]) expect(() => guard.canActivate(context(tag, token))).toThrow('Token interno inválido');
  });
}
test('legacy Atlas health remains public', () => {
  expect(new LegacyInternalAuthGuard(new Reflector()).canActivate(context('ATLAS', undefined, true))).toBe(true);
});
test('global fallback remains available only to original global-token aliases', () => {
  delete process.env.API_MACHINE_INTERNAL_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = 'fallback';
  const guard = new LegacyInternalAuthGuard(new Reflector());
  expect(guard.canActivate(context('PAGATG', 'fallback'))).toBe(true);
  expect(() => guard.canActivate(context('EBOOK', 'fallback'))).toThrow();
});
