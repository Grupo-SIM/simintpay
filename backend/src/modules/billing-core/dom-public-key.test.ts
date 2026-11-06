import { describe, expect, test } from 'bun:test';
import { GLOBAL_DOM_PUBLIC_KEY, resolveDomPublicKey } from './dom-public-key';

describe('resolveDomPublicKey', () => {
  test('global account uses the env override or the checkout key', () => {
    expect(resolveDomPublicKey('GLOBAL', {})).toBe(GLOBAL_DOM_PUBLIC_KEY);
    expect(resolveDomPublicKey(null, { DOM_PUBLIC_KEY: 'pk_other' })).toBe(
      'pk_other',
    );
  });

  test('an unregistered platform never gets the global key', () => {
    expect(() => resolveDomPublicKey('NOPE-PLATFORM', {})).toThrow();
  });
});
