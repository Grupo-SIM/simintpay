import { afterEach, describe, expect, test } from 'bun:test';
import { OfferLegacyWebhookSender } from './offer-legacy-webhook.sender';
import {
  initializePlatformIntegrationsCache,
  invalidatePlatformIntegrationsCache,
} from '../platform-integrations/platform-integrations.store';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';

process.env.PLATFORM_CONFIG_ENCRYPTION_KEY ??= 'ab'.repeat(32);

async function configure(
  rows: { key: string; url?: string; secret?: string }[],
) {
  await initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () =>
        rows.map((r) => ({
          key: r.key,
          url: r.url ?? null,
          encryptedValue: r.secret ? encryptPlatformSecret(r.secret) : null,
          platform: { tag: 'AREAFLIX' },
        })),
    },
  } as never);
}

function make(status = 200) {
  const sender = new OfferLegacyWebhookSender();
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }[] = [];
  sender.resolve = async () => ['93.184.216.34'];
  sender.post = async (url, init) => {
    calls.push({ url, ...init });
    return { status };
  };
  return { sender, calls };
}
const offer = (webhookUrl: string | null) => ({
  id: 'offer-1',
  platformTag: 'AREAFLIX',
  metadata: webhookUrl ? { webhookUrl } : null,
});

afterEach(() => invalidatePlatformIntegrationsCache());

describe('OfferLegacyWebhookSender', () => {
  test('posts the exact JSON with the platform WEBHOOK_SECRET as x-simpay-token', async () => {
    await configure([{ key: 'WEBHOOK_SECRET', secret: 'platform-secret' }]);
    process.env.SIMPAY_WEBHOOK_TOKEN = 'global-token';
    const { sender, calls } = make();
    expect(
      await sender.send(
        offer('https://app.example/hook'),
        'purchase_approved',
        { a: 1 },
      ),
    ).toBe(true);
    expect(calls).toEqual([
      {
        url: 'https://app.example/hook',
        headers: {
          'content-type': 'application/json',
          'x-simpay-token': 'platform-secret',
        },
        body: '{"a":1}',
      },
    ]);
    delete process.env.SIMPAY_WEBHOOK_TOKEN;
  });

  test('omits the header without a platform secret', async () => {
    await configure([]);
    const { sender, calls } = make();
    await sender.send(
      offer('https://app.example/hook'),
      'purchase_approved',
      {},
    );
    expect(calls[0].headers).toEqual({ 'content-type': 'application/json' });
  });

  test('no URL is success without a request', async () => {
    const { sender, calls } = make();
    expect(await sender.send(offer(null), 'purchase_approved', {})).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('unsafe literal and DNS-private hosts are refused without a request', async () => {
    const { sender, calls } = make();
    expect(
      await sender.send(offer('http://127.0.0.1/x'), 'purchase_approved', {}),
    ).toBe(true);
    sender.resolve = async () => ['10.0.0.5'];
    expect(
      await sender.send(
        offer('https://rebind.example/x'),
        'purchase_approved',
        {},
      ),
    ).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test('5xx and network errors ask for a retry; a 4xx does not', async () => {
    const down = make(503);
    expect(
      await down.sender.send(
        offer('https://a.example/h'),
        'purchase_approved',
        {},
      ),
    ).toBe(false);
    const rejected = make(400);
    expect(
      await rejected.sender.send(
        offer('https://a.example/h'),
        'purchase_approved',
        {},
      ),
    ).toBe(true);
    const broken = make();
    broken.sender.post = async () => {
      throw new Error('ECONNRESET');
    };
    expect(
      await broken.sender.send(
        offer('https://a.example/h'),
        'purchase_approved',
        {},
      ),
    ).toBe(false);
  });

  test('skips the signed events when the URL equals the platform WEBHOOK_URL already served by the outbox', async () => {
    await configure([
      { key: 'WEBHOOK_SECRET', secret: 's' },
      { key: 'WEBHOOK_URL', url: 'https://app.example/hook' },
    ]);
    const { sender, calls } = make();
    const o = offer('https://app.example/hook');
    expect(await sender.send(o, 'purchase_approved', {})).toBe(true);
    expect(await sender.send(o, 'subscription_activated', {})).toBe(true);
    expect(calls).toHaveLength(0);
    // renewal/expiry never go through the outbox, so they are always sent
    await sender.send(o, 'subscription_renewed', {});
    await sender.send(o, 'subscription_expired', {});
    expect(calls).toHaveLength(2);
    // a different URL is not covered
    await sender.send(
      offer('https://other.example/hook'),
      'purchase_approved',
      {},
    );
    expect(calls).toHaveLength(3);
  });

  test('without an offer URL, renewal/expiry use the HTTPS platform WEBHOOK_URL with its secret', async () => {
    await configure([
      { key: 'WEBHOOK_SECRET', secret: 'platform-secret' },
      { key: 'WEBHOOK_URL', url: 'https://platform.example/hook' },
    ]);
    const { sender, calls } = make();
    for (const event of [
      'subscription_renewed',
      'subscription_expired',
    ] as const)
      expect(await sender.send(offer(null), event, { event })).toBe(true);
    // signed events are the outbox's job on that same URL
    await sender.send(offer(null), 'purchase_approved', {});
    await sender.send(offer(null), 'subscription_activated', {});
    expect(calls.map((c) => [c.url, c.headers['x-simpay-token']])).toEqual([
      ['https://platform.example/hook', 'platform-secret'],
      ['https://platform.example/hook', 'platform-secret'],
    ]);
  });

  test('the platform URL needs HTTPS, a secret and passes the same SSRF barrier', async () => {
    const { sender, calls } = make();
    await configure([
      { key: 'WEBHOOK_SECRET', secret: 's' },
      { key: 'WEBHOOK_URL', url: 'http://platform.example/hook' },
    ]);
    expect(await sender.send(offer(null), 'subscription_renewed', {})).toBe(
      true,
    );
    await configure([
      { key: 'WEBHOOK_URL', url: 'https://platform.example/h' },
    ]);
    expect(await sender.send(offer(null), 'subscription_renewed', {})).toBe(
      true,
    );
    await configure([
      { key: 'WEBHOOK_SECRET', secret: 's' },
      { key: 'WEBHOOK_URL', url: 'https://rebind.example/h' },
    ]);
    sender.resolve = async () => ['10.0.0.9'];
    expect(await sender.send(offer(null), 'subscription_renewed', {})).toBe(
      true,
    );
    expect(calls).toHaveLength(0);
  });

  test('the offer URL has priority over the platform URL', async () => {
    await configure([
      { key: 'WEBHOOK_SECRET', secret: 's' },
      { key: 'WEBHOOK_URL', url: 'https://platform.example/hook' },
    ]);
    const { sender, calls } = make();
    await sender.send(
      offer('https://own.example/hook'),
      'subscription_renewed',
      {},
    );
    expect(calls.map((c) => c.url)).toEqual(['https://own.example/hook']);
  });
});
