import { describe, expect, test } from 'bun:test';
import {
  consolidadoTagFor,
  findPlataformaDetalheByTag,
} from './consolidado-tag';

describe('report platform aliases', () => {
  test('Zero Grau preserves its detailed report across database and legacy tags', () => {
    const row = { tag: 'ZERO_GRAU', subtotalBruto: 10507.89 };
    expect(consolidadoTagFor('zero_grau')).toBe('ZERO-GRAU');
    expect(findPlataformaDetalheByTag([row], 'ZERO-GRAU')).toBe(row);
    expect(
      findPlataformaDetalheByTag([{ ...row, tag: 'ZERO-GRAU' }], 'ZERO_GRAU')
        ?.subtotalBruto,
    ).toBe(10507.89);
  });
  test('Ebook alias remains valid and unrelated platforms never match', () => {
    expect(
      findPlataformaDetalheByTag([{ tag: 'EBOOK' }], 'EBOOKSIM')?.tag,
    ).toBe('EBOOK');
    expect(
      findPlataformaDetalheByTag([{ tag: 'ZERO-GRAU' }], 'RENOVADA'),
    ).toBeNull();
  });
});
