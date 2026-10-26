import { expect, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { reportBuyerCpf, reportBuyerCpfSql } from './report-buyer.helper';

test('CPF identity ignores punctuation and excludes missing, incomplete and company documents', () => {
  expect(reportBuyerCpf('123.456.789-01')).toBe('12345678901');
  expect(reportBuyerCpf('12345678901')).toBe('12345678901');
  for (const value of [null, undefined, '', '   ', '123', '12.345.678/0001-90']) {
    expect(reportBuyerCpf(value)).toBeNull();
  }
});

test('SQL buyer identity normalizes CPF and never falls back to email or phone', () => {
  const sql = reportBuyerCpfSql(Prisma.sql`t."customerDocument"`);
  expect(sql.text).toContain('regexp_replace');
  expect(sql.text).toContain('= 11');
  expect(sql.text).toContain('ELSE NULL');
  expect(sql.text).not.toContain('customerEmail');
});
