import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  platformOwnerLabel,
  productPlatformOptions,
} from './product-platforms';

const platforms = [
  { tag: 'OWN', name: 'Minha loja', ownerUserId: 'owner', isActive: true },
  {
    tag: 'OTHER',
    name: 'Outra loja',
    ownerUserId: 'other',
    owner: { id: 'other', name: 'Ana' },
    isActive: true,
  },
  {
    tag: 'INACTIVE',
    name: 'Loja inativa',
    ownerUserId: 'owner',
    isActive: false,
  },
];

describe('product platform visibility', () => {
  it('hides other owners and inactive platforms from regular accounts', () => {
    assert.deepEqual(
      productPlatformOptions(platforms, { id: 'owner', isAdmin: false }),
      [{ value: 'OWN', label: 'Minha loja', disabled: false }],
    );
    assert.deepEqual(
      productPlatformOptions(platforms, { id: 'unrelated', isAdmin: false }),
      [],
    );
    assert.deepEqual(productPlatformOptions(platforms, null), []);
  });

  it('lists all platforms for admins by name with inactive indicators', () => {
    const options = productPlatformOptions(platforms, {
      id: 'owner',
      isAdmin: true,
    });
    assert.equal(options.length, 3);
    assert.equal(options[0].label, 'Minha loja');
    assert.equal(options[1].label, 'Outra loja');
    assert.equal(options[2].label, 'Loja inativa (Inativa)');
    assert.equal(options[2].disabled, true);
    assert.equal(options[0].selectedLabel, 'Minha loja');
    assert.equal(options[1].selectedLabel, 'Outra loja');
  });
});

it('identifies owners by name without exposing IDs or emails', () => {
  assert.equal(
    platformOwnerLabel(
      { owner: { id: 'other', name: 'Ana', email: 'ana@example.com' } },
      { id: 'admin' },
    ),
    'Usuário: Ana',
  );
  assert.equal(
    platformOwnerLabel({ ownerUserId: 'other' }, { id: 'admin' }),
    'Nome do proprietário indisponível',
  );
  assert.equal(
    platformOwnerLabel({}, { id: 'admin' }),
    'Nome do proprietário indisponível',
  );
});
