import { describe, expect, mock, test } from 'bun:test';
import { PlatformPaymentLookup } from './platform-payment-lookup';

function fixture(description = '[TENANT:FIRST]') {
  const row = { id: 'payment', description, userId: 'old-owner' };
  const query = mock(async () => row);
  const platform = {
    id: 'first',
    tag: 'FIRST',
    ownerUserId: 'new-owner',
    acquirer: 'DOM',
    isActive: true,
    owner: { isActive: true, isPurged: false },
  };
  const lookup = new PlatformPaymentLookup({
    platform: { findUnique: async () => platform },
    transaction: { findFirst: query },
  } as never);
  return { lookup, query, platform, row };
}
describe('Shared payment reference lookup', () => {
  test('status lookup scopes platform without hiding a payment routed to another acquirer', async () => {
    const f = fixture();
    expect(
      await f.lookup.find(
        { tag: 'FIRST', id: 'first', ownerUserId: 'new-owner' },
        'external',
      ),
    ).toBe(f.row);
    expect((f.query.mock.calls as any)[0][0].where).toMatchObject({
      AND: [
        { platformTag: 'FIRST' },
        {
          OR: [
            { id: 'external' },
            { domPaymentId: 'external' },
            { domTransactionId: 'external' },
            { externalPaymentId: 'external' },
          ],
        },
      ],
    });
  });
  test('platform is decided by the stored platformTag column, never by description markers', async () => {
    const f = fixture('[TENANT:FIRST][TENANT:SECOND]');
    await f.lookup.find({ tag: 'FIRST' }, 'external');
    const where = JSON.stringify((f.query.mock.calls as any)[0][0].where);
    expect(where).toContain('"platformTag":"FIRST"');
    expect(where).not.toContain('TENANT');
  });
  test('inactive owner and ownership transfer reject stale context before lookup', async () => {
    const f = fixture();
    await expect(
      f.lookup.find({ tag: 'FIRST', ownerUserId: 'old-owner' }, 'external'),
    ).rejects.toThrow('Plataforma ou dono');
    f.platform.owner.isActive = false;
    await expect(f.lookup.find({ tag: 'FIRST' }, 'external')).rejects.toThrow(
      'Plataforma ou dono',
    );
    expect(f.query).not.toHaveBeenCalled();
  });
});
