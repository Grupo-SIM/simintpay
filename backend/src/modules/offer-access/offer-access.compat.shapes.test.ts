import { describe, expect, it } from 'bun:test';
import { PixPlanService } from '../../application/use-cases/pix-plan/pix-plan.service';
import { OfferAccessCompatService } from './offer-access.compat.service';
import { OfferAccessService } from './offer-access.service';
import { offerPixPlanCompatEnabled } from './pixplan-compat-flag';

/**
 * The same logical fixture feeds the legacy PixPlanService (PixCreditPlan / PixPlanLinkCode /
 * CustomerPlanAccess rows) and the offer-backed compat service (Offer / OfferCodeAlias /
 * OfferAccess rows); every response must have the same JSON.
 */
const created = new Date('2026-10-01T10:00:00.000Z');
const updated = new Date('2026-10-02T10:00:00.000Z');
const future = new Date(Date.now() + 10 * 86_400_000);

const planRow = {
  id: 'plan-1',
  userId: 'user-1',
  createdByUserId: 'user-1',
  type: 'TRIMESTRAL',
  price: 149.9,
  description: 'Crédito trimestral',
  redirectUrl: 'https://shop.example.com/ok',
  webhookUrl: 'https://shop.example.com/hook',
  status: 'ACTIVE',
  emailBody: null,
  tenantTag: 'PAGATG',
  createdAt: created,
  updatedAt: updated,
};
const linkRow = {
  id: 'link-1',
  code: 'PX-ABC123',
  pixCreditPlanId: 'plan-1',
  isActive: true,
  createdAt: created,
  updatedAt: created,
};

const offer = {
  id: 'plan-1',
  ownerUserId: 'user-1',
  createdByUserId: 'user-1',
  platformTag: 'PAGATG',
  code: 'OFFERCODE1',
  name: 'Crédito trimestral',
  description: 'Crédito trimestral',
  amountCents: 14990,
  isActive: true,
  acceptedMethods: ['PIX'],
  renewalMode: 'MANUAL_PAY',
  intervalType: 'MONTH',
  intervalCount: 3,
  accessDays: 90,
  fulfillment: { redirectUrl: 'https://shop.example.com/ok' },
  metadata: {
    pixPlan: { kind: 'PLAN', webhookUrl: 'https://shop.example.com/hook' },
  },
  createdAt: created,
  updatedAt: updated,
};
const alias = {
  id: 'link-1',
  code: 'PX-ABC123',
  offerId: 'plan-1',
  kind: 'PX',
  isActive: true,
  createdAt: created,
  offer,
};

function legacy() {
  const repo: any = {
    findPixPlanLinkCodeByCode: async (code: string) =>
      code === linkRow.code ? linkRow : null,
    findPixPlanLinkCodeByCodeWithPlan: async (code: string) =>
      code === linkRow.code ? { ...linkRow, pixCreditPlan: planRow } : null,
    findPixCreditPlanById: async (id: string) =>
      id === planRow.id ? planRow : null,
    findActiveCustomerPlanAccess: async () => ({
      id: 'acc-1',
      isActive: true,
      expiresAt: future,
      totalDaysCredited: 90,
      createdAt: created,
    }),
    findCustomerPlanAccessById: async () => ({
      id: 'acc-1',
      isActive: true,
      expiresAt: future,
      totalDaysCredited: 90,
      createdAt: created,
    }),
    updateCustomerPlanAccessById: async () => undefined,
  };
  const prisma: any = {
    pixPlanLinkCode: { findFirst: async () => linkRow },
  };
  return new PixPlanService(repo, {} as never, prisma);
}

function compat() {
  const prisma: any = {
    offerCodeAlias: {
      findFirst: async ({ where }: any) =>
        where.code === alias.code || where.offerId === alias.offerId
          ? alias
          : null,
    },
    offer: {
      findUnique: async ({ where }: any) =>
        where.id === offer.id ? offer : null,
    },
    offerAccess: {
      findFirst: async () => ({
        id: 'acc-1',
        isActive: true,
        expiresAt: future,
        totalDaysCredited: 90,
        frozenDays: 0,
      }),
      findUniqueOrThrow: async () => ({
        id: 'acc-1',
        isActive: true,
        expiresAt: future,
        totalDaysCredited: 90,
        frozenDays: 0,
      }),
    },
  };
  const access = new OfferAccessService(prisma, {} as never, {} as never);
  return {
    compat: new OfferAccessCompatService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      access,
    ),
    access,
  };
}

describe('compat responses match the legacy PIX plan controller', () => {
  it('GET pix-plan/link-code/:code', async () => {
    expect(await compat().compat.getLinkCode('PX-ABC123')).toEqual(
      (await legacy().getPixPlanLinkCode('PX-ABC123')) as never,
    );
  });

  it('GET pix-plan/link-code-details/:code/checkout', async () => {
    expect(await compat().compat.getLinkCodeDetails('PX-ABC123')).toEqual(
      await legacy().getPixPlanLinkCodeDetailsForCheckout('PX-ABC123'),
    );
  });

  it('GET pix-plan/:id', async () => {
    expect(await compat().compat.getPlan('user-1', 'plan-1')).toEqual(
      await legacy().getPixCreditPlanById('user-1', 'plan-1'),
    );
  });

  it('GET plan-access', async () => {
    const a = await compat().access.getPlanAccess('user-1', '123.456.789-09');
    const b = await legacy().getPlanAccess('user-1', '123.456.789-09');
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual([
      'isActive',
      'expiresAt',
      'remainingDays',
      'totalDaysCredited',
    ]);
  });

  it('GET plan-access without credit answers the same empty shape', async () => {
    const c = compat();
    (c.access as any).prisma.offerAccess.findFirst = async () => null;
    const l = legacy();
    (l as any).repo.findActiveCustomerPlanAccess = async () => null;
    expect(await c.access.getPlanAccess('user-1', '1')).toEqual(
      await l.getPlanAccess('user-1', '1'),
    );
  });

  it('unknown or inactive codes answer the same 404 messages', async () => {
    const c = compat();
    await expect(c.compat.getLinkCode('PX-NOPE')).rejects.toThrow(
      'Link-code PIX-PLAN não encontrado ou inativo',
    );
    await expect(c.compat.getLinkCodeDetails('PX-NOPE')).rejects.toThrow(
      'Link code PIX-PLAN não encontrado',
    );
  });
});

describe('OFFER_PIXPLAN_COMPAT flag', () => {
  it('is off by default and on for 1/true', () => {
    expect(offerPixPlanCompatEnabled({})).toBe(false);
    expect(offerPixPlanCompatEnabled({ OFFER_PIXPLAN_COMPAT: '0' })).toBe(
      false,
    );
    expect(offerPixPlanCompatEnabled({ OFFER_PIXPLAN_COMPAT: '1' })).toBe(true);
    expect(offerPixPlanCompatEnabled({ OFFER_PIXPLAN_COMPAT: 'true' })).toBe(
      true,
    );
  });
});
