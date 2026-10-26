import { afterEach, describe, expect, test } from 'bun:test';
import { decryptPlatformSecret, encryptPlatformSecret, hashPlatformToken } from './platform-secrets';
const original = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
afterEach(() => { if (original === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = original; });
describe('encrypted platform credentials', () => {
  test('round trips without exposing plaintext and randomizes ciphertext', () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    const first = encryptPlatformSecret('test-secret');
    expect(first).not.toContain('test-secret');
    expect(encryptPlatformSecret('test-secret')).not.toBe(first);
    expect(decryptPlatformSecret(first)).toBe('test-secret');
    expect(hashPlatformToken('test-secret')).toHaveLength(64);
  });
  test('rejects tampering and missing key', () => {
    process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'b'.repeat(64);
    const parts = encryptPlatformSecret('credential').split(':');
    parts[2] = '0'.repeat(32);
    expect(() => decryptPlatformSecret(parts.join(':'))).toThrow();
    delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
    expect(() => encryptPlatformSecret('credential')).toThrow();
  });
});
