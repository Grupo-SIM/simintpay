import { beforeAll, describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { GLOBAL_DOM_PUBLIC_KEY } from '../billing-core/dom-public-key';
import { OfferSubscribeService } from './offer-subscribe.service';

beforeAll(() => {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.DOM_TOKEN = 'private-api-token';
});

const offer = {
  id: 'o1',
  isActive: true,
  expiresAt: null,
  platformTag: null,
  renewalMode: 'AUTO_CHARGE',
};

function build(kind: string, getOrCreateCustomer?: (...a: any[]) => any) {
  const gateway: any = { getOrCreateCustomer };
  const service = new OfferSubscribeService(
    { offer: { findUnique: async () => offer } } as never,
    {} as never,
    {
      acquirerForSlug: () => 'DOM',
      byAcquirer: () => gateway,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { kind } as never,
  );
  return service as any;
}

const card = {
  token: 'wallet-token',
  customerId: 'cus-1',
  last4: '4242',
  exp_month: '12',
  exp_year: '2031',
  holder_name: 'Ana',
  brand: 'visa',
};

describe('customer-token card payload', () => {
  test('keeps only metadata and an encrypted token; never PAN/CVV', () => {
    const meta = build('customer-token').cardMetadata(card);
    expect(meta).toMatchObject({
      last4: '4242',
      expMonth: 12,
      expYear: 2031,
      customerId: 'cus-1',
    });
    expect(meta.encryptedToken).toBeString();
    expect(meta.encryptedToken).not.toContain('wallet-token');
    expect(JSON.stringify(meta)).not.toContain('wallet-token');
  });

  test('rejects number or cvv in this mode', () => {
    const service = build('customer-token');
    expect(() =>
      service.cardMetadata({ ...card, number: '4111111111111111' }),
    ).toThrow(BadRequestException);
    expect(() => service.cardMetadata({ ...card, cvv: '123' })).toThrow(
      BadRequestException,
    );
  });

  test('requires token, customerId, last4 and a valid expiry', () => {
    const service = build('customer-token');
    for (const bad of [
      { token: '' },
      { customerId: '' },
      { last4: '42' },
      { exp_month: '13' },
    ])
      expect(() => service.cardMetadata({ ...card, ...bad })).toThrow(
        BadRequestException,
      );
  });

  test('legacy sources still require the full card', () => {
    const service = build('subscription');
    expect(() => service.cardMetadata(card)).toThrow(BadRequestException);
    expect(
      service.cardMetadata({
        ...card,
        number: '4111 1111 1111 1111',
        cvv: '123',
        holder_document: '12345678909',
      }),
    ).toMatchObject({ last4: '1111' });
  });
});

describe('cardCustomer', () => {
  const body = {
    customerName: 'Ana',
    customerEmail: 'Ana@Test.dev',
    customerDocument: '123.456.789-09',
  };

  test('returns customerId and the public key, never the private token', async () => {
    const calls: any[] = [];
    const service = build('customer-token', async (token: string, c: any) => {
      calls.push({ token, c });
      return 'cus-77';
    });
    const out = await service.cardCustomer('CODE', body);
    expect(out).toEqual({
      customerId: 'cus-77',
      publicKey: process.env.DOM_PUBLIC_KEY || GLOBAL_DOM_PUBLIC_KEY,
    });
    expect(JSON.stringify(out)).not.toContain('private-api-token');
    expect(calls[0].token).toBe('private-api-token');
    expect(calls[0].c).toMatchObject({
      email: 'ana@test.dev',
      document: '12345678909',
      documentType: 'CPF',
      phone: '',
    });
  });

  test('is unavailable for the legacy sources', async () => {
    await expect(
      build('subscription', async () => 'x').cardCustomer('CODE', body),
    ).rejects.toThrow(BadRequestException);
  });
});
