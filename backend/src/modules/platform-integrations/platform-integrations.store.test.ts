import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Logger } from '@nestjs/common';
import { encryptPlatformSecret } from './platform-secrets';
import { getPlatformIntegrationValue, initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from './platform-integrations.store';

const originalKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
const errors = spyOn(Logger.prototype, 'error').mockImplementation(() => {});
const row = (tag: string, key: string, url: string | null, encryptedValue: string | null = null) => ({ platform: { tag }, key, url, encryptedValue });
const initialize = (rows: ReturnType<typeof row>[]) => initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => rows } } as never);

afterAll(() => errors.mockRestore());

afterEach(() => {
  if (originalKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = originalKey;
  invalidatePlatformIntegrationsCache();
  errors.mockClear();
});

describe('platform integrations cache', () => {
  test('isolates wrong-key credentials and excludes every row of the affected platform', async () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    const oldSecret = encryptPlatformSecret('old-secret');
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'b'.repeat(64);
    await initialize([
      row('BROKEN', 'API_URL', 'https://example.com'),
      row('BROKEN', 'API_TOKEN', null, oldSecret),
      row('BROKEN', 'OTHER_URL', 'https://example.org'),
      row('HEALTHY', 'API_TOKEN', null, encryptPlatformSecret('healthy-secret')),
    ]);
    for (const key of ['API_URL', 'API_TOKEN', 'OTHER_URL']) expect(getPlatformIntegrationValue('BROKEN', key)).toBeNull();
    expect(getPlatformIntegrationValue('HEALTHY', 'API_TOKEN')).toBe('healthy-secret');
    expect(errors).toHaveBeenCalledTimes(1);
    const message = String(errors.mock.calls[0][0]);
    expect(message).toContain('BROKEN');
    expect(message).toContain('API_TOKEN');
    expect(message).not.toContain(oldSecret);
    expect(message).not.toContain('old-secret');
  });

  test('removes cached credentials on failure and recovers after recadastro', async () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    const secret = encryptPlatformSecret('secret');
    await initialize([row('EBOOKSIM', 'API_TOKEN', null, secret)]);
    expect(getPlatformIntegrationValue('EBOOK', 'API_TOKEN')).toBe('secret');
    await initialize([row('EBOOKSIM', 'API_TOKEN', null, 'invalid')]);
    expect(getPlatformIntegrationValue('EBOOK', 'API_TOKEN')).toBeNull();
    await initialize([row('EBOOKSIM', 'API_TOKEN', null, secret)]);
    expect(getPlatformIntegrationValue('EBOOK', 'API_TOKEN')).toBe('secret');
  });

  test('keeps public-only platforms available with a missing encryption key', async () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    const secret = encryptPlatformSecret('secret');
    delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
    await initialize([row('BROKEN', 'API_TOKEN', null, secret), row('PUBLIC', 'API_URL', 'https://example.com')]);
    expect(getPlatformIntegrationValue('BROKEN', 'API_TOKEN')).toBeNull();
    expect(getPlatformIntegrationValue('PUBLIC', 'API_URL')).toBe('https://example.com');
  });
});
