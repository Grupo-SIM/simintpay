import { assertExplicitPlatform } from './explicit-platform.helper';

jest.mock('../../modules/module.registry', () => ({
  getRegisteredPlatform: (tag: string) => tag === 'EXAMPLE' ? { ownerUserId: 'owner' } : null,
}));
jest.mock('../../modules/platform-taxas/platform-taxas.store', () => ({
  canonicalPlatformTaxaTag: (tag: string) => tag.toUpperCase(),
}));
jest.mock('../../modules/platform-integrations/platform-integrations.store', () => ({
  getPlatformIntegrationValue: jest.fn(),
}));

describe('explicit platform ownership', () => {
  it('allows the owner and rejects another regular account even with administrative mode enabled', () => {
    expect(assertExplicitPlatform({ id: 'owner', role: 'USER' }, ['EXAMPLE'], true)).toBe('EXAMPLE');
    expect(() => assertExplicitPlatform({ id: 'other', role: 'USER' }, ['EXAMPLE'], true))
      .toThrow('Plataforma não atribuída a esta conta');
  });

  it('allows an administrator only when the operation explicitly enables administrative access', () => {
    const admin = { id: 'admin', role: 'ADMIN' };
    expect(assertExplicitPlatform(admin, ['EXAMPLE'], true)).toBe('EXAMPLE');
    expect(() => assertExplicitPlatform(admin, ['EXAMPLE'])).toThrow('Plataforma não atribuída a esta conta');
  });

  it('rejects unknown platforms and multiple selections for administrators', () => {
    const admin = { id: 'admin', role: 'ADMIN' };
    expect(() => assertExplicitPlatform(admin, ['UNKNOWN'], true)).toThrow('Plataforma não cadastrada ou inativa');
    expect(() => assertExplicitPlatform(admin, ['EXAMPLE', 'UNKNOWN'], true)).toThrow('Selecione uma única plataforma');
  });
});
