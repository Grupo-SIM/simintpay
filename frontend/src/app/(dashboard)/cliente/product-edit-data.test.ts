import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { editedPixDescription, splitPixDescription } from './product-edit-data';

describe('PIX editing preserves legacy metadata', () => {
  it('hides owner and routing metadata during hydration', () => {
    const description =
      'Plano antigo [CPF_DONO:12345678901] [TENANT:CLIENTE] [NOME_DONO:Cliente]';
    assert.equal(splitPixDescription(description).text, 'Plano antigo');
    assert.equal(
      editedPixDescription('Plano novo', description),
      'Plano novo [CPF_DONO:12345678901] [TENANT:CLIENTE] [NOME_DONO:Cliente]',
    );
  });
  it('handles clean and missing descriptions without inventing metadata', () => {
    assert.deepEqual(splitPixDescription(null), { text: '', metadata: [] });
    assert.equal(
      editedPixDescription('  Plano mensal  ', 'Anterior'),
      'Plano mensal',
    );
  });
});
