import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';
import {
  configuredPreviewParents,
  isAllowedPreviewParent,
  isPreviewDraftMessage,
  previewFramePolicy,
} from './payment-link-preview';
import { previewLink } from './payment-link-preview-adapter';

const valid = () => ({
  type: 'payment-link-preview:draft',
  version: 1,
  draft: {
    title: 'Rascunho não salvo',
    description: 'Descrição atual',
    amount: 100,
    methods: { credit: true, debit: true, pix: true },
    maxInstallments: 2,
    installments: [
      { count: 1, total: 109, amount: 109, interest: 9 },
      { count: 2, total: 114, amount: 57, interest: 14 },
    ],
    pixAmount: 100,
    debitAmount: 100,
  },
});

describe('payment link preview contract', () => {
  test('accepts the version 1 draft sent by the dashboard', () => {
    expect(isPreviewDraftMessage(valid())).toBe(true);
    const link = previewLink(valid().draft);
    expect(link.titulo).toBe('Rascunho não salvo');
    expect(link.opcoesParcelas[1]).toMatchObject({
      parcelas: 2,
      valorTotal: 114,
      valorParcela: 57,
    });
    expect(link).not.toHaveProperty('redirectUrl');
    expect(link).not.toHaveProperty('ofertas');
  });
  test('rejects credentials, personal fields, invalid versions and inconsistent installments', () => {
    const message = valid();
    for (const value of [
      null,
      [],
      { ...message, version: 2 },
      { ...message, token: 'secret' },
      { ...message, draft: { ...message.draft, email: 'buyer@example.test' } },
      { ...message, draft: { ...message.draft, files: [] } },
      { ...message, draft: { ...message.draft, amount: NaN } },
      { ...message, draft: { ...message.draft, maxInstallments: 13 } },
      { ...message, draft: { ...message.draft, installments: new Array(2) } },
      {
        ...message,
        draft: {
          ...message.draft,
          installments: [
            { count: 1, total: 109, amount: 109, interest: 9 },
            { count: 2, total: 114, amount: 90, interest: 14 },
          ],
        },
      },
    ])
      expect(isPreviewDraftMessage(value)).toBe(false);
  });
  test('supports disabled methods and zero-price drafts', () => {
    const message = valid();
    const draft = {
      ...message.draft,
      methods: { credit: false, debit: false, pix: false },
      maxInstallments: 1,
      amount: 0,
      pixAmount: 0,
      debitAmount: 0,
      installments: [{ count: 1, total: 0, amount: 0, interest: 0 }],
    };
    expect(isPreviewDraftMessage({ ...message, draft })).toBe(true);
    expect(previewLink(draft)).toMatchObject({
      aceitaCartao: false,
      aceitaPix: false,
      aceitaDebito: false,
      valor: 0,
    });
  });
});

describe('preview embedding policy', () => {
  test('production accepts only exact configured HTTPS origins', () => {
    expect(
      isAllowedPreviewParent(
        'https://simintpay.com',
        'https://simintpay.com',
        false,
      ),
    ).toBe(true);
    for (const origin of [
      'https://simintpay.com.evil.test',
      'http://simintpay.com',
      'http://localhost:3100',
      'https://localhost:3100',
    ]) {
      expect(
        isAllowedPreviewParent(origin, 'https://simintpay.com', false),
      ).toBe(false);
    }
    expect(isAllowedPreviewParent('https://simintpay.com', '', false)).toBe(
      false,
    );
  });
  test('development additionally permits localhost ports', () => {
    expect(isAllowedPreviewParent('http://localhost:3100', '', true)).toBe(
      true,
    );
    expect(isAllowedPreviewParent('http://127.0.0.1:3100', '', true)).toBe(
      true,
    );
    expect(isAllowedPreviewParent('http://evil.test:3100', '', true)).toBe(
      false,
    );
    expect(previewFramePolicy([], true)).toContain('http://localhost:*');
    expect(previewFramePolicy([], false)).toBe("frame-ancestors 'none'");
  });
  test('route receives CSP, no-store and no-referrer; normal routes are outside matcher', () => {
    const response = proxy(
      new NextRequest(
        'https://checkout.simintermediacoes.com/preview/payment-link',
      ),
    );
    expect(response.headers.get('Content-Security-Policy')).toBe(
      previewFramePolicy(
        configuredPreviewParents(),
        process.env.NODE_ENV === 'development',
      ),
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.has('X-Frame-Options')).toBe(false);
    expect(config.matcher).toEqual([
      '/',
      '/preview/payment-link',
      '/preview/offer',
    ]);
    expect(
      new NextRequest(
        'https://checkout.simintermediacoes.com/preview/payment-link',
      ).nextUrl.pathname,
    ).toBe(config.matcher[1]);
  });
});
