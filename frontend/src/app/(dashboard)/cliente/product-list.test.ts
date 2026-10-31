import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterProducts, mapProduct, type ProductKind } from './product-list';

describe('client product listing contracts', () => {
  it('retains stable checkout identity for all five product kinds', () => {
    const cases: [ProductKind, string][] = [
      ['planos', 'simPlanCode=product'],
      ['planos-pix', 'code=stable'],
      ['links-pagamento', 'simLinkCode=product'],
      ['links-assinatura', 'subscriptionLinkCode=stable'],
      ['boletos', 'simBoletoCode=product'],
    ];
    for (const [kind, suffix] of cases) {
      const row = mapProduct(kind, {
        id: 'product',
        code: 'stable',
        linkCode: 'stable',
        nome: 'Alterado',
        preco: 14.99,
        type: 'MONTHLY',
        status: 'ACTIVE',
      });
      assert.equal(row.amount, 14.99);
      assert.ok(row.url?.endsWith(suffix), kind);
    }
  });
  it('reads each backend field contract without rendering internal PIX owner tags', () => {
    assert.equal(
      mapProduct('planos', {
        id: '1',
        nome: 'Plano',
        preco: '29.99',
        tipo: 'TRIMESTRAL',
        ativo: false,
      }).interval,
      'Trimestral',
    );
    assert.equal(
      mapProduct('links-pagamento', {
        id: '1',
        titulo: 'Produto',
        valor: '49.90',
        ativo: false,
      }).active,
      false,
    );
    assert.equal(
      mapProduct('planos-pix', {
        id: '1',
        description: 'Mensal [CPF:12345678901|TENANT] [TENANT:INTERNAL]',
        price: '19.99',
        status: 'INACTIVE',
      }).name,
      'Mensal',
    );
    assert.equal(
      mapProduct('boletos', { id: '1', vencimentoDias: 0 }).interval,
      'Sem vencimento',
    );
    assert.equal(
      mapProduct('boletos', { id: '1', vencimentoDias: 1 }).interval,
      '1 dia',
    );
  });
  it('normalizes platforms and settled status across product contracts', () => {
    const row = mapProduct('links-assinatura', {
      id: '1',
      plataformas: ['AREAFLIX', 'AREAFLIX'],
      plataforma: 'SIMINTPAY',
      maxUses: 2,
      currentUses: 2,
    });
    assert.deepEqual(row.platforms, ['SIMINTPAY', 'AREAFLIX']);
    assert.equal(row.status, 'Limite atingido');
    assert.equal(
      mapProduct('planos', { id: '1', isActive: 'inactive' }).status,
      'Inativo',
    );
    assert.equal(
      mapProduct('planos-pix', {
        id: '1',
        tenantTag: 'EBOOKSIM',
        status: 'INACTIVE',
      }).status,
      'Inativo',
    );
    assert.equal(
      filterProducts([row], {
        search: '',
        status: 'all',
        platform: 'AREAFLIX',
        start: '',
        end: '',
      }).length,
      1,
    );
    assert.equal(
      filterProducts([row], {
        search: '',
        status: 'all',
        platform: 'ATLAS',
        start: '',
        end: '',
      }).length,
      0,
    );
  });
  it('combines search, status and inclusive local creation dates', () => {
    const rows = [
      mapProduct('planos', {
        id: '1',
        nome: 'Mensal',
        ativo: true,
        criadoEm: '2026-10-14T20:00:00-03:00',
      }),
      mapProduct('planos', {
        id: '2',
        nome: 'Mensal',
        ativo: false,
        criadoEm: '2026-10-14T12:00:00-03:00',
      }),
      mapProduct('planos', { id: '3', nome: 'Mensal', ativo: true }),
    ];
    assert.deepEqual(
      filterProducts(rows, {
        search: ' MENSAL ',
        status: 'active',
        start: '2026-10-14',
        end: '2026-10-14',
      }).map((row) => row.id),
      ['1'],
    );
  });
});
