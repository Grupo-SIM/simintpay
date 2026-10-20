import { expect, test } from 'bun:test';
import { acceptsPlatformSyncDescription } from './platform-sync.adapter';

for (const tag of ['ATLAS', 'REVALIDA', 'BOSQUE', 'RENOVADA', 'ZERO-GRAU', 'CLIENT']) {
  test(`${tag}: explicit marker identifies platform independently of product name`, () => {
    for (const product of ['DOMAIN example.com', 'HOSTING VPS-10-1784846']) {
      expect(acceptsPlatformSyncDescription(`${product} [TENANT:${tag}]`, tag)).toBe(true);
      expect(acceptsPlatformSyncDescription(`${product} [TENANT:${tag.replaceAll('-', '_').toLowerCase()}]`, tag)).toBe(true);
      expect(acceptsPlatformSyncDescription(`atlas ${product} [TENANT:OTHER]`, tag)).toBe(false);
      expect(acceptsPlatformSyncDescription(`${product} [TENANT:${tag}] [TENANT:OTHER]`, tag)).toBe(false);
    }
  });
}

test('unmarked historical names retain legacy classification without guessing product ownership', () => {
  expect(acceptsPlatformSyncDescription('Atlas fatura antiga', 'ATLAS')).toBe(true);
  expect(acceptsPlatformSyncDescription('Revalida plano antigo', 'REVALIDA')).toBe(true);
  expect(acceptsPlatformSyncDescription('DOMAIN example.com', 'ATLAS')).toBe(false);
  expect(acceptsPlatformSyncDescription('HOSTING VPS-10-1784846', 'ATLAS')).toBe(false);
});
