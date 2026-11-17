import { expect, mock, test } from 'bun:test';
import { PlatformLinksController } from './platform-links.controller';

const context = {
  id: 'platform',
  tag: 'CENTRAL-INFO',
  ownerUserId: 'owner',
  acquirer: 'DOM',
};

function fixture() {
  process.env.SIMPAY_CHECKOUT_URL = 'https://checkout.test/';
  const created = {
    id: 'link',
    code: 'CODE',
    name: 'Livro',
    amountCents: 2700,
    isActive: true,
    renewalMode: 'NONE',
    acceptedMethods: ['PIX'],
    fulfillment: {},
    metadata: {},
    platformTag: 'CENTRAL-INFO',
    ownerUserId: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const create = mock(async (..._args: unknown[]) => created);
  const prisma = {
    offer: {
      findUnique: mock(async () => null),
      findFirst: mock(async (..._args: unknown[]) => null),
    },
  };
  const controller = new PlatformLinksController(
    prisma as never,
    {
      get: () => ({ create }),
    } as never,
  );
  return {
    controller,
    prisma,
    create,
    req: { platformContext: context } as never,
  };
}

test('canonical creation derives owner and platform from credential', async () => {
  const f = fixture();
  const result = await f.controller.create(
    f.req,
    { titulo: 'Livro', valor: 27 },
    'unique-key',
  );
  expect(f.create.mock.calls[0][0]).toMatchObject({ id: 'owner' });
  expect(f.create.mock.calls[0][1]).toMatchObject({
    ownerUserId: 'owner',
    platformTag: 'CENTRAL-INFO',
  });
  expect(result.checkoutUrl).toBe('https://checkout.test/?simLinkCode=link');
});

test('rejects minimum price, missing key, non-HTTPS callback and platform injection', async () => {
  const f = fixture();
  await expect(
    f.controller.create(f.req, { titulo: 'Livro', valor: 14.98 }, 'key'),
  ).rejects.toThrow();
  await expect(
    f.controller.create(f.req, { titulo: 'Livro', valor: 27 }, ''),
  ).rejects.toThrow();
  await expect(
    f.controller.create(
      f.req,
      { titulo: 'Livro', valor: 27, webhookUrl: 'http://example.test' },
      'key',
    ),
  ).rejects.toThrow();
  await expect(
    f.controller.create(
      f.req,
      { titulo: 'Livro', valor: 27, plataformas: ['OTHER'] },
      'key',
    ),
  ).rejects.toThrow();
  expect(f.create).not.toHaveBeenCalled();
});

test('update and files cannot address another platform link', async () => {
  const f = fixture();
  await expect(
    f.controller.update(f.req, 'foreign', { titulo: 'Troca' }),
  ).rejects.toThrow();
  await expect(f.controller.files(f.req, 'foreign', [])).rejects.toThrow();
  expect(f.prisma.offer.findFirst.mock.calls[0][0]).toMatchObject({
    where: {
      id: 'foreign',
      ownerUserId: 'owner',
      platformTag: 'CENTRAL-INFO',
    },
  });
  expect(f.create).not.toHaveBeenCalled();
});
