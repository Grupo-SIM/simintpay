import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { Prisma } from '@prisma/client';
import { ChargePaymentLinkUseCase } from '../../application/use-cases/payment-link/charge-payment-link.use-case';
import {
  makeFakePrisma,
  makeLink,
  makeOffer as makeLegacyOffer,
  money,
  useEmptyCaches,
} from '../../application/use-cases/payment-link/charge-characterization.fixture';
import { Acquirer } from '../../core/services/acquirer.enum';
import { acquirerCapabilities } from '../../core/services/acquirer-capabilities';
import { ExternalRefService } from '../billing-core/external-ref.service';
import { OfferCheckoutService } from './offer-checkout.service';
import {
  configureCheckoutPolicy,
  makeOffer,
  makeOfferDb,
} from './offer-checkout.fixture';

const oldToken = process.env.DOM_TOKEN;
beforeAll(useEmptyCaches);
beforeEach(() => {
  process.env.DOM_TOKEN = 'test-token';
});
afterEach(() => {
  if (oldToken === undefined) delete process.env.DOM_TOKEN;
  else process.env.DOM_TOKEN = oldToken;
});

const buyer = {
  customerName: 'Ana',
  customerEmail: 'buyer@example.test',
  customerDocument: '123.456.789-01',
  customerPhone: '(81) 99999-9999',
};
const card = { token: 'fake' } as never;

function setup(
  mainOver: Record<string, unknown> = {},
  others: Record<string, unknown>[] = [],
) {
  const main = makeOffer({
    amountCents: 10000,
    fulfillment: {
      bumps: [
        { offerId: 'bump-1', role: 'BUMP' },
        { offerId: 'up-1', role: 'UPSELL' },
        { offerId: 'down-1', role: 'DOWNSELL' },
      ],
    },
    ...mainOver,
  });
  const extra = [
    makeOffer({
      id: 'bump-1',
      code: 'BUMP00001',
      name: 'Bump',
      amountCents: 2000,
    }),
    makeOffer({
      id: 'up-1',
      code: 'UP0000001',
      name: 'Upsell X',
      amountCents: 5000,
    }),
    makeOffer({
      id: 'down-1',
      code: 'DOWN000001',
      name: 'Downsell',
      amountCents: 3000,
    }),
    ...others.map((o) => makeOffer(o)),
  ];
  const db = makeOfferDb(main, {}, extra);
  configureCheckoutPolicy(db.prisma);
  let links = 0;
  const gateway: any = {
    createPaymentLink: async () => ({ id: `dom-link-${++links}` }),
    chargePaymentLink: async () => ({ id: 'dom-pay', status: 'pending' }),
  };
  const resolver: any = {
    acquirerForSlug: () => Acquirer.DOM,
    capabilitiesFor: acquirerCapabilities,
    byAcquirer: () => gateway,
  };
  const service = new OfferCheckoutService(
    db.prisma,
    { findById: async () => ({ id: 'owner' }) } as any,
    resolver,
    new ExternalRefService(db.prisma),
  );
  const charge = (code: string, over: Record<string, unknown> = {}) =>
    service.charge(code, {
      paymentMethod: 'credit_card',
      installments: 1,
      card,
      ...buyer,
      ...over,
    } as never);
  const byId = (id: string) => db.offers.find((o: any) => o.id === id);
  return { service, db, main, charge, byId };
}

async function linkNumbers(bump: boolean, upsell: boolean) {
  const db = makeFakePrisma(
    upsell
      ? {
          offers: [
            makeLegacyOffer({
              id: 'up-1',
              type: 'UPSELL',
              title: 'Upsell X',
              price: new Prisma.Decimal(50),
            }),
          ],
          parent: {
            id: 'parent-tx',
            status: 'COMPLETED',
            customerEmail: buyer.customerEmail,
          },
        }
      : { offers: [makeLegacyOffer()] },
  );
  configureCheckoutPolicy(db.prisma);
  const link = makeLink();
  const service = new ChargePaymentLinkUseCase(
    { findById: async () => link, update: async () => link } as never,
    { findById: async () => ({ id: 'owner', platform: null }) } as never,
    {
      chargePaymentLink: async () => ({ id: 'dom', status: 'pending' }),
    } as never,
    db.prisma,
  );
  await service.execute({
    linkId: 'link',
    ...buyer,
    paymentMethod: 'credit_card',
    installments: 1,
    card: { token: 'fake' },
    ...(bump ? { orderBumpIds: ['bump-1'] } : {}),
    ...(upsell ? { offerId: 'up-1', parentPaymentId: 'parent-tx' } : {}),
  } as never);
  return money(db.row());
}

describe('offers and payment links use the same configured financial policy', () => {
  test('offer + order bump == link + order bump (amount, net, fees)', async () => {
    const f = setup();
    const out = await f.charge(f.main.code, { bumpCodes: ['BUMP00001'] });
    const legacy = await linkNumbers(true, false);
    expect(money(f.db.base.row())).toEqual(legacy);
    expect(legacy.amount).toBe(120);
    expect(out.amount).toBe(120);
    expect(f.db.base.row().description).toBe('Curso + Bump');
    expect(f.db.charges[0].amountCents).toBe(12000);
    expect(f.db.charges[0].snapshot.items.map((i: any) => i.role)).toEqual([
      'MAIN',
      'BUMP',
    ]);
    expect(f.main.usedCount).toBe(1);
  });

  test('upsell matches the payment link quote without consuming uses', async () => {
    const f = setup({ maxUses: 1 });
    const first = await f.charge(f.main.code);
    f.db.charges[0].status = 'PAID';
    f.db.charges[0].customerEmail = buyer.customerEmail;
    expect(f.main.usedCount).toBe(1);
    const up = f.byId('up-1');
    await f.charge(up.code, { parentChargeId: first.chargeId });
    const legacy = await linkNumbers(false, true);
    expect(money(f.db.base.rows().at(-1))).toEqual(legacy);
    expect(legacy.amount).toBe(50);
    expect(up.usedCount).toBe(0);
    expect(f.main.usedCount).toBe(1);
    expect(f.db.charges[1].snapshot).toMatchObject({
      parentChargeId: first.chargeId,
      funnelRole: 'UPSELL',
    });
    expect(f.db.base.rows().at(-1).description).toBe('Upsell X | Upsell');
  });
});

describe('funnel guards', () => {
  test('upsell needs a PAID parent of the same buyer linked by the parent offer', async () => {
    const f = setup();
    const parent = await f.charge(f.main.code);
    const up = f.byId('up-1');
    await expect(
      f.charge(up.code, { parentChargeId: parent.chargeId }),
    ).rejects.toThrow('não aprovado');
    f.db.charges[0].status = 'PAID';
    f.db.charges[0].customerEmail = 'other@x.dev';
    await expect(
      f.charge(up.code, { parentChargeId: parent.chargeId }),
    ).rejects.toThrow('outro comprador');
    f.db.charges[0].customerEmail = buyer.customerEmail;
    await expect(
      f.charge(f.main.code, { parentChargeId: parent.chargeId }),
    ).rejects.toThrow('não encontrada');
    await expect(f.charge(up.code, { parentChargeId: 'nope' })).rejects.toThrow(
      'não aprovado',
    );
  });

  test('a paid post-purchase offer blocks its duplicate but allows other funnel offers', async () => {
    const f = setup();
    const parent = await f.charge(f.main.code);
    f.db.charges[0].status = 'PAID';
    f.db.charges[0].customerEmail = buyer.customerEmail;
    await f.charge(f.byId('up-1').code, { parentChargeId: parent.chargeId });
    f.db.charges[1].status = 'PAID';
    await expect(
      f.charge(f.byId('up-1').code, { parentChargeId: parent.chargeId }),
    ).rejects.toThrow('já adquirida');
    await expect(
      f.charge(f.byId('down-1').code, { parentChargeId: parent.chargeId }),
    ).resolves.toHaveProperty('chargeId');
  });

  test('bumps must be listed by the main offer, active and of the same owner', async () => {
    const stranger = setup({}, [
      { id: 'x', code: 'STRANGER01', ownerUserId: 'other', amountCents: 1000 },
    ]);
    for (const code of ['STRANGER01', 'UP0000001', 'NOPE'])
      await expect(
        stranger.charge(stranger.main.code, { bumpCodes: [code] }),
      ).rejects.toThrow('Order bump indisponível');
    const off = setup();
    off.byId('bump-1').isActive = false;
    await expect(
      off.charge(off.main.code, { bumpCodes: ['BUMP00001'] }),
    ).rejects.toThrow('Order bump indisponível');
    expect(off.db.charges).toHaveLength(0);
    expect(off.main.usedCount).toBe(0);
  });
});
