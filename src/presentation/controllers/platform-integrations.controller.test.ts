import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformIntegrationsController } from './platform-integrations.controller';

function fixture(ownerUserId = 'owner') {
  const findMany = mock(async () => [{ key: 'DOM_TOKEN', encryptedValue: 'ciphertext', url: null }, { key: 'BACKEND_URL', encryptedValue: null, url: 'https://example.com' }]);
  const prisma = { user: { findUnique: async () => ({ id: 'owner', role: 'USER', isActive: true }) }, platform: { findUnique: async () => ({ ownerUserId }) }, platformIntegration: { findMany } };
  return { controller: new PlatformIntegrationsController(prisma as never), findMany };
}
const user = { sub: 'owner', role: 'USER', email: 'owner@example.com' };
describe('platform integration management', () => {
  test('masks secrets while exposing configured public URL', async () => {
    const { controller } = fixture();
    const response = await controller.list('platform', user);
    expect(response.data).toEqual([{ key: 'DOM_TOKEN', value: '********', configured: true }, { key: 'BACKEND_URL', value: 'https://example.com', configured: true }]);
    expect(JSON.stringify(response)).not.toContain('ciphertext');
  });
  test('rejects other owner before loading credentials', async () => {
    const { controller, findMany } = fixture('another');
    await expect(controller.list('platform', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
  test('integration token cannot manage secrets', async () => {
    const { controller, findMany } = fixture();
    await expect(controller.list('platform', { ...user, authMode: 'integration' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

test('only admin can associate a retroactive claim source', async () => {
  const { controller } = fixture();
  await expect(controller.put('platform', 'CLAIM_SOURCE_USER_ID', { value: 'source' }, user)).rejects.toBeInstanceOf(ForbiddenException);
});

test('external database URL requires admin and is encrypted, masked and protocol validated', async () => {
  const oldKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  const writes: any[] = [];
  let role = 'USER';
  const prisma: any = { user: { findUnique: async () => ({ id: 'owner', role, isActive: true }) }, platform: { findUnique: async () => ({ id: 'p', ownerUserId: 'owner', tag: 'ATLAS' }) },
    platformIntegration: { findMany: async () => [], upsert: async (input: any) => { writes.push(input.create); return input.create; } } };
  const controller = new PlatformIntegrationsController(prisma);
  try {
    await expect(controller.put('p', 'EXTERNAL_DATABASE_URL', { value: 'postgresql://local:fixture@127.0.0.1/test' }, user)).rejects.toBeInstanceOf(ForbiddenException);
    role = 'ADMIN';
    await expect(controller.put('p', 'EXTERNAL_DATABASE_URL', { value: 'https://example.test' }, user)).rejects.toThrow('PostgreSQL');
    await controller.put('p', 'EXTERNAL_DATABASE_URL', { value: 'postgresql://local:fixture@127.0.0.1/test' }, user);
    expect(writes[0].url).toBeNull(); expect(writes[0].encryptedValue).toStartWith('v1:');
    expect(JSON.stringify(writes)).not.toContain('local:fixture');
  } finally { if (oldKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = oldKey; }
});
