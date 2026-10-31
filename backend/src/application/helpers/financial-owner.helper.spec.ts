import {
  assertOwnershipPreserved,
  resolveFinancialOwner,
} from './financial-owner.helper';

jest.mock('../../modules/module.registry', () => ({
  getRegisteredPlatform: (tag: string) =>
    tag === 'SHOP' ? { ownerUserId: 'owner' } : null,
}));
jest.mock('../../modules/platform-taxas/platform-taxas.store', () => ({
  canonicalPlatformTaxaTag: (tag: string) => tag.toUpperCase(),
}));
jest.mock(
  '../../modules/platform-integrations/platform-integrations.store',
  () => ({ getPlatformIntegrationValue: jest.fn() }),
);
const accounts = [
  { id: 'admin', role: 'ADMIN', email: 'admin@example.test' },
  {
    id: 'owner',
    role: 'USER',
    email: 'owner@example.test',
    ownedPlatforms: [{ tag: 'SHOP' }, { tag: 'OTHER' }],
  },
  {
    id: 'member',
    role: 'USER',
    email: 'member@example.test',
    platform: { tag: 'SHOP' },
  },
  { id: 'other', role: 'USER', email: 'other@example.test' },
  {
    id: 'inactive',
    role: 'USER',
    email: 'inactive@example.test',
    isActive: false,
  },
];
const users = {
  findById: async (id: string) =>
    accounts.find((account) => account.id === id) ?? null,
  findByEmail: async (email: string) =>
    accounts.find((account) => account.email === email) ?? null,
};
describe('financial beneficiary resolution', () => {
  it('requires an explicit non-administrative beneficiary for administrators', async () => {
    await expect(resolveFinancialOwner(users, 'admin', {})).rejects.toThrow(
      'Selecione um titular',
    );
    await expect(
      resolveFinancialOwner(users, 'admin', { ownerUserId: 'admin' }),
    ).rejects.toThrow('não administrativa');
    await expect(
      resolveFinancialOwner(users, 'admin', { ownerUserId: 'inactive' }),
    ).rejects.toThrow('não administrativa');
    expect(
      (await resolveFinancialOwner(users, 'admin', { ownerUserId: 'owner' }))
        .owner.id,
    ).toBe('owner');
  });
  it('separates delegated execution from proceeds and records the actor', async () => {
    const result = await resolveFinancialOwner(users, 'member', {
      platforms: ['SHOP'],
    });
    expect(result.owner.id).toBe('owner');
    expect(result.createdByUserId).toBe('member');
  });
  it('allows personal sales despite multiple owned platforms', async () => {
    expect(
      (await resolveFinancialOwner(users, 'owner', {})).platformTag,
    ).toBeNull();
  });
  it('rejects forged or conflicting destinations', async () => {
    await expect(
      resolveFinancialOwner(users, 'other', { platforms: ['SHOP'] }),
    ).rejects.toThrow();
    await expect(
      resolveFinancialOwner(users, 'other', { ownerUserId: 'owner' }),
    ).rejects.toThrow();
    await expect(
      resolveFinancialOwner(users, 'admin', {
        platforms: ['SHOP'],
        ownerUserId: 'other',
      }),
    ).rejects.toThrow('difere');
    await expect(
      resolveFinancialOwner(users, 'admin', {
        ownerUserId: 'owner',
        email: 'other@example.test',
      }),
    ).rejects.toThrow('conflitantes');
  });
  it('preserves owner and complete platform context on edits', () => {
    const existing = { userId: 'owner', plataformas: ['SHOP'] };
    expect(() =>
      assertOwnershipPreserved(existing, { plataformas: ['shop'] }),
    ).not.toThrow();
    expect(() =>
      assertOwnershipPreserved(existing, { plataformas: ['SHOP', 'OTHER'] }),
    ).toThrow();
    expect(() =>
      assertOwnershipPreserved(existing, { ownerUserId: 'admin' }),
    ).toThrow();
    expect(() =>
      assertOwnershipPreserved(
        { userId: 'owner', plataformas: ['SIMINTPAY'] },
        { plataformas: [] },
      ),
    ).not.toThrow();
  });
});
