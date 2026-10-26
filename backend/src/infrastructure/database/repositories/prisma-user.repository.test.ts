import { expect, mock, test } from 'bun:test';
import { PrismaUserRepository } from './prisma-user.repository';

test('user creation includes a zero wallet in the same atomic write', async () => {
  const create = mock(async ({ data }: any) => {
    expect(data.wallet).toEqual({ create: { balance: 0, lockedBalance: 0 } });
    return { id: 'owner', ...data };
  });
  const users = new PrismaUserRepository({ user: { create } } as never);
  await users.create({ name: 'Maria', email: 'maria@example.com', password: 'hash' });
  expect(create).toHaveBeenCalledTimes(1);
});

