import { describe, expect, test } from 'bun:test';
import {
  firstFunnelStage,
  funnelChargeBody,
  funnelPrice,
  nextFunnelStage,
} from './offer-funnel-model';
import type { PublicOffer } from './offer-checkout-model';

const bump = (role: 'BUMP' | 'UPSELL' | 'DOWNSELL', code: string) => ({
  code,
  role,
  name: code,
  description: null,
  amountCents: 1000,
});
const offer = (roles: ('BUMP' | 'UPSELL' | 'DOWNSELL')[]): PublicOffer => ({
  code: 'OF-1',
  name: 'Main',
  description: null,
  amountCents: 5000,
  acceptedMethods: ['PIX', 'CREDIT_CARD'],
  maxInstallments: 1,
  renewalMode: 'NONE',
  intervalType: null,
  intervalCount: null,
  bumps: roles.map((r, i) => bump(r, `B${i}`)),
});

describe('offer funnel', () => {
  test('starts on the upsell only with a paid parent and a supported method', () => {
    const o = offer(['BUMP', 'UPSELL']);
    expect(firstFunnelStage(o, 'pix', 'ch1')).toBe('upsell');
    expect(firstFunnelStage(o, 'boleto', 'ch1')).toBe('done');
    expect(firstFunnelStage(o, 'pix', null)).toBe('done');
    expect(firstFunnelStage(offer(['BUMP']), 'pix', 'ch1')).toBe('done');
  });

  test('declining the upsell offers the downsell, everything else ends', () => {
    const o = offer(['UPSELL', 'DOWNSELL']);
    expect(nextFunnelStage(o, 'upsell', false)).toBe('downsell');
    expect(nextFunnelStage(o, 'upsell', true)).toBe('done');
    expect(nextFunnelStage(o, 'downsell', false)).toBe('done');
    expect(nextFunnelStage(offer(['UPSELL']), 'upsell', false)).toBe('done');
  });

  test('prices card at 1x and builds the child charge body', () => {
    const pricing = {
      options: [
        {
          installments: 1,
          totalAmount: 11,
          installmentAmount: 11,
          interestAmount: 0,
        },
      ],
      pixAmount: 10,
      debitAmount: 10.5,
    };
    expect(funnelPrice(pricing, 'credit_card')).toBe(11);
    expect(funnelPrice(pricing, 'pix')).toBe(10);
    const body = funnelChargeBody({
      method: 'pix',
      parentChargeId: 'ch1',
      customer: { name: 'Ana', email: 'a@b.co', document: '123', phone: '1' },
    });
    expect(body.parentChargeId).toBe('ch1');
    expect('card' in body).toBe(false);
  });
});
