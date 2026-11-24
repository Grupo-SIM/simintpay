import { describe, expect, test } from 'bun:test';
import { resolveDomPublicKey } from './dom-public-key';

describe('resolveDomPublicKey', () => {
  test('global account uses the DOM_PUBLIC_KEY env', () => {
    expect(resolveDomPublicKey('GLOBAL', { DOM_PUBLIC_KEY: 'pk_env' })).toBe(
      'pk_env',
    );
  });

  test('a platform without its own key falls back to the env key', () => {
    expect(
      resolveDomPublicKey('NOPE-PLATFORM', { DOM_PUBLIC_KEY: 'pk_env' }),
    ).toBe('pk_env');
  });

  test('throws when no key is configured anywhere', () => {
    expect(() => resolveDomPublicKey('GLOBAL', {})).toThrow();
  });
});
