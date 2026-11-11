import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canClientAccessPath } from './dashboard-access';

describe('client dashboard route boundary', () => {
  it('allows current client products, transactions and existing self-service', () => {
    for (const route of [
      '/ofertas',
      '/ofertas/criar',
      '/relatorio',
      '/plataformas',
      '/plataformas/SHOP',
      '/cliente/planos/criar',
      '/cliente/boletos',
      '/transacoes',
      '/transacoes/123',
      '/painel',
      '/cobrancas',
      '/configuracoes/perfil',
    ])
      assert.equal(canClientAccessPath(route), true, route);
  });
  it('blocks direct admin/platform and expanded operational URLs', () => {
    for (const route of [
      '/admin/leads',
      '/painel/revalida',
      '/painel/renovada',
      '/assinantes',
      '/planos/criar',
      '/planos-pix/123/assinantes',
      '/transacoes-admin',
    ])
      assert.equal(canClientAccessPath(route), false, route);
  });
});
