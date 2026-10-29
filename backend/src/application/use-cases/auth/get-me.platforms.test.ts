import { describe, expect, mock, test } from 'bun:test';
import { GetMeUseCase } from './get-me.use-case';
import { assertExplicitPlatform } from '../../helpers/explicit-platform.helper';

describe('Account owning multiple platform products', () => {
  test('me lists all products and returns stored shared wallet without assigning untagged history', async () => {
    const user = {
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      role: 'USER',
      createdAt: new Date(),
      platform: null,
      ownedPlatforms: [
        { id: 'p1', tag: 'FIRST', name: 'First', isActive: true },
        { id: 'p2', tag: 'SECOND', name: 'Second', isActive: true },
      ],
    };
    const transactions = mock(async () => []);
    const service = new GetMeUseCase(
      { findById: async () => user } as never,
      {} as never,
      {} as never,
      {
        wallet: {
          findUnique: async () => ({
            balance: '123.45',
            lockedBalance: '23.45',
          }),
        },
        transaction: { findMany: transactions },
      } as never,
    );
    const result = await service.execute({ userId: 'owner' });
    expect(result.ownedPlatforms).toEqual(user.ownedPlatforms);
    expect(result.platform).toBeNull();
    expect(result.walletScope).toBe('shared-owner');
    expect(result.wallet).toEqual({
      balance: 123.45,
      lockedBalance: 23.45,
      availableBalance: 100,
      netBalance: 100,
    });
    expect(transactions).not.toHaveBeenCalled();
  });
  test('personal financial input remains valid with multiple owned platforms', () => {
    expect(
      assertExplicitPlatform(
        { id: 'owner', ownedPlatforms: [{ tag: 'FIRST' }, { tag: 'SECOND' }] },
        undefined,
      ),
    ).toBeNull();
  });
});
