import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { decryptPlatformSecret, encryptPlatformSecret, hashPlatformToken } from '../../modules/platform-integrations/platform-secrets';
import { PlatformIntegrationsController } from './platform-integrations.controller';

function fixture(ownerUserId = 'owner') {
  const findMany = mock(async (_args: unknown) => [{ key: 'DOM_TOKEN', encryptedValue: 'ciphertext', url: null }, { key: 'BACKEND_URL', encryptedValue: null, url: 'https://example.com' }]);
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

test('settings reveals only integration credentials to an authorized session', async () => {
  const oldKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    const { controller, findMany } = fixture();
    findMany.mockImplementation(async () => [
      { key: 'INBOUND_TOKEN', encryptedValue: encryptPlatformSecret('inbound'), url: null },
      { key: 'WEBHOOK_SECRET', encryptedValue: encryptPlatformSecret('webhook'), url: null },
      { key: 'INBOUND_OPERATIONS', encryptedValue: null, url: 'payments:read' },
      { key: 'DOM_TOKEN', encryptedValue: encryptPlatformSecret('private-acquirer-token'), url: null },
    ]);
    expect((await controller.settings('platform', user)).data).toEqual({ INBOUND_TOKEN: 'inbound', WEBHOOK_SECRET: 'webhook', INBOUND_OPERATIONS: 'payments:read', WEBHOOK_URL: null });
    expect(findMany.mock.calls[0][0]).toEqual({ where: { platformId: 'platform', key: { in: ['INBOUND_TOKEN', 'INBOUND_OPERATIONS', 'WEBHOOK_SECRET', 'WEBHOOK_URL'] } } });
    const foreign = fixture('another');
    await expect(foreign.controller.settings('platform', user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(foreign.findMany).not.toHaveBeenCalled();
    await expect(controller.settings('platform', { ...user, authMode: 'integration' })).rejects.toBeInstanceOf(ForbiddenException);
  } finally { if (oldKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = oldKey; }
});

test('owner rotates both encrypted secrets atomically and initializes only missing scopes', async () => {
  const oldKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  const rows = new Map<string, any>([['INBOUND_OPERATIONS', { key: 'INBOUND_OPERATIONS', url: 'payments:read' }], ['WEBHOOK_URL', { key: 'WEBHOOK_URL', url: 'https://example.test/events' }]]);
  let transactions = 0;
  const prisma: any = {
    user: { findUnique: async () => ({ id: 'owner', role: 'USER', isActive: true }) },
    platform: { findUnique: async () => ({ ownerUserId: 'owner' }) },
    platformIntegration: { findMany: async () => [...rows.values()] },
    $transaction: async (callback: any) => {
      transactions++;
      return callback({ platformIntegration: { upsert: async ({ create, update }: any) => { rows.set(create.key, rows.has(create.key) ? { ...rows.get(create.key), ...update } : create); } } });
    },
  };
  try {
    const controller = new PlatformIntegrationsController(prisma);
    const first = (await controller.rotateCredentials('p', user)).data;
    expect(first.INBOUND_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(first.WEBHOOK_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(first.INBOUND_TOKEN).not.toBe(first.WEBHOOK_SECRET);
    expect(rows.get('INBOUND_TOKEN').tokenHash).toBe(hashPlatformToken(first.INBOUND_TOKEN!));
    expect(decryptPlatformSecret(rows.get('WEBHOOK_SECRET').encryptedValue)).toBe(first.WEBHOOK_SECRET!);
    expect(first.INBOUND_OPERATIONS).toBe('payments:read');
    expect(first.WEBHOOK_URL).toBe('https://example.test/events');
    rows.delete('INBOUND_OPERATIONS');
    const second = (await controller.rotateCredentials('p', user)).data;
    expect(second.INBOUND_TOKEN).not.toBe(first.INBOUND_TOKEN);
    expect(second.WEBHOOK_SECRET).not.toBe(first.WEBHOOK_SECRET);
    expect(second.INBOUND_OPERATIONS).toContain('payments:create');
    await expect(controller.rotateCredentials('p', { ...user, authMode: 'integration' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transactions).toBe(2);
  } finally { if (oldKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = oldKey; }
});
