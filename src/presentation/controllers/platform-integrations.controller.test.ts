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
