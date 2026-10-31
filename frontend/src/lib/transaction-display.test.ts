import { describe, expect, test } from 'bun:test';
import { formatTransacaoDescricaoUi, transacaoPlataformaUi } from './utils';

describe('transaction presentation', () => {
  test('hides all markers without changing the original description', () => {
    const raw = 'Plano [TENANT:BOSQUE] mensal [ tenant : RENOVADA ]';
    expect(formatTransacaoDescricaoUi(raw)).toBe('Plano mensal');
    expect(raw).toBe('Plano [TENANT:BOSQUE] mensal [ tenant : RENOVADA ]');
    expect(transacaoPlataformaUi('ASSOCIADA', raw)).toBe('ASSOCIADA');
    expect(transacaoPlataformaUi(null, raw)).toBe('BOSQUE');
  });
  test('handles absent and marker-only descriptions', () => {
    expect(formatTransacaoDescricaoUi(null)).toBe('');
    expect(formatTransacaoDescricaoUi('[TENANT:BOSQUE]')).toBe('');
    expect(formatTransacaoDescricaoUi('Plano mensal')).toBe('Plano mensal');
    expect(transacaoPlataformaUi(null, 'Plano mensal')).toBeUndefined();
  });
});
