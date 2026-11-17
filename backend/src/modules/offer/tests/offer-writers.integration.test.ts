import { afterAll, expect, test } from 'bun:test';
import 'reflect-metadata';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AdminController } from '../../../presentation/controllers/admin.controller';
import { PrismaUserRepository } from '../../../infrastructure/database/repositories/prisma-user.repository';
import { PlatformFinanceService } from '../../unified-platform/finance/platform-finance.service';
import { PlatformLinksController } from '../../platform-core/platform-links.controller';
import { LegacyLinksCompatService } from '../legacy-links.compat.service';
import { initializePlatformRegistryCache } from '../../module.registry';
import { OfferAssetsService } from '../offer-assets.service';
import { OfferService } from '../offer.service';

const url = process.env.OFFER_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
  throw new Error('Offer integration tests require a local database');
const db = url
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  : null;
afterAll(async () => {
  await db?.$disconnect();
});

async function seed() {
  const prisma = db!;
  const sfx = crypto.randomUUID().slice(0, 8);
  const owner = await prisma.user.create({
    data: { email: `w-${sfx}@w.local`, password: 'x', name: 'writer' },
  });
  const tag = `WT${sfx}`.toUpperCase();
  await prisma.platform.create({
    data: { tag, name: tag, ownerUserId: owner.id },
  });
  await initializePlatformRegistryCache(prisma);
  const users = new PrismaUserRepository(prisma as never);
  const offers = new OfferService(prisma as never, users as never);
  const uploaded: string[] = [];
  const assets = new OfferAssetsService(
    prisma as never,
    {
      uploadFile: async (f: { originalname: string }) => {
        uploaded.push(f.originalname);
        return `https://files.test/${f.originalname}`;
      },
    } as never,
  );
  const modules = {
    get: (cls: unknown) =>
      cls === OfferService
        ? offers
        : cls === OfferAssetsService
          ? assets
          : null,
  };
  const context = {
    id: `platform-${sfx}`,
    tag,
    ownerUserId: owner.id,
    acquirer: 'DOM',
  };
  return {
    prisma,
    sfx,
    owner,
    tag,
    users,
    offers,
    assets,
    modules,
    context,
    uploaded,
  };
}

test.skipIf(!db)(
  'REST adapters answer from Offer: create, list, edit, deactivate',
  async () => {
    const { prisma, owner, tag, users, offers } = await seed();
    const compat = new LegacyLinksCompatService(
      offers,
      prisma as never,
      users as never,
    );
    const actor = { id: owner.id, role: 'USER' };
    const created = await compat.createPaymentLink(actor, {
      titulo: 'Livro',
      valor: 27,
      plataformas: [tag],
    } as never);
    const id = created.data.id;
    expect(await prisma.paymentLink.findUnique({ where: { id } })).toBeNull();
    expect((await compat.listPaymentLinks(actor, {} as never)).total).toBe(1);
    await compat.updatePaymentLink(actor, id, { titulo: 'Livro 2' } as never);
    expect((await prisma.offer.findUnique({ where: { id } }))!.name).toBe(
      'Livro 2',
    );
    await compat.deletePaymentLink(actor, id);
    expect((await prisma.offer.findUnique({ where: { id } }))!.isActive).toBe(
      false,
    );
  },
);

test.skipIf(!db)(
  'platform routes write only Offer (create, replay, edit, files)',
  async () => {
    const { prisma, modules, context } = await seed();
    process.env.SIMPAY_CHECKOUT_URL = 'https://checkout.test/';
    const controller = new PlatformLinksController(
      prisma as never,
      modules as never,
    );
    const req = { platformContext: context } as never;
    const created = await controller.create(
      req,
      { titulo: 'Livro', valor: 27 } as never,
      'key-1',
    );
    const id = created.data.id;
    const offer = await prisma.offer.findUnique({ where: { id } });
    expect(offer?.platformTag).toBe(context.tag);
    expect(offer?.ownerUserId).toBe(context.ownerUserId);
    expect(await prisma.paymentLink.findUnique({ where: { id } })).toBeNull();
    const replay = await controller.create(
      req,
      { titulo: 'Livro', valor: 27 } as never,
      'key-1',
    );
    expect(replay.data.id).toBe(id);
    expect(
      await prisma.offer.count({ where: { platformTag: context.tag } }),
    ).toBe(1);
    await controller.update(req, id, { titulo: 'Livro 2', valor: 30 } as never);
    const edited = await prisma.offer.findUnique({ where: { id } });
    expect([edited!.name, edited!.amountCents]).toEqual(['Livro 2', 3000]);
    const pdf = {
      mimetype: 'application/pdf',
      originalname: 'a.pdf',
      size: 5,
      buffer: Buffer.from('%PDF-1'),
    } as never;
    const files = (await controller.files(req, id, [pdf])) as {
      files: unknown[];
    };
    expect(files.files).toHaveLength(1);
    expect(
      await prisma.paymentLinkFile.count({ where: { paymentLinkId: id } }),
    ).toBe(0);
    await expect(
      controller.update(req, 'foreign', { titulo: 'x' } as never),
    ).rejects.toThrow();
  },
);

test.skipIf(!db)(
  'platform plan import (mirrorPlan) writes Offer',
  async () => {
    const { prisma, owner, tag } = await seed();
    const service = new PlatformFinanceService(prisma as never);
    const data = {
      name: 'Pro',
      price: 49.9,
      type: 'MONTHLY',
      paymentMethods: 'CREDIT_CARD',
    } as never;
    const code = `PLAN${tag}`;
    const first = await service.mirrorPlan(tag, owner.id, code, data);
    expect(first.created).toBe(true);
    const again = await service.mirrorPlan(tag, owner.id, code, {
      ...(data as object),
      name: 'Pro 2',
    } as never);
    expect(again).toMatchObject({ created: false, id: first.id });
    const row = await prisma.offer.findUnique({ where: { code } });
    expect([row!.name, row!.amountCents, row!.renewalMode]).toEqual([
      'Pro 2',
      4990,
      'AUTO_CHARGE',
    ]);
    expect(await prisma.plan.findUnique({ where: { code } })).toBeNull();
    const other = await prisma.user.create({
      data: { email: `o-${tag}@w.local`, password: 'x', name: 'o' },
    });
    await expect(
      service.mirrorPlan(tag, other.id, code, data),
    ).rejects.toThrow();
  },
);

test.skipIf(!db)(
  'admin cobrança link is an Offer',
  async () => {
    const { prisma, owner } = await seed();
    const make = (
      AdminController.prototype as never as {
        createCobrancaLink: (
          u: string,
          t: string,
          a: number,
          d: string | null,
        ) => Promise<{ id: string }>;
      }
    ).createCobrancaLink.bind({ prisma });
    const offer = await make(owner.id, 'Cobrança', 20, null);
    expect(
      (await prisma.offer.findUnique({ where: { id: offer.id } }))!.platformTag,
    ).toBe('SIMINTPAY');
    expect(
      await prisma.paymentLink.findUnique({ where: { id: offer.id } }),
    ).toBeNull();
  },
);
