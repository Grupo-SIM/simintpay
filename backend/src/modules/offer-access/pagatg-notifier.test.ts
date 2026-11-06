import { beforeEach, describe, expect, it } from 'bun:test';
import {
  initializePlatformIntegrationsCache,
  invalidatePlatformIntegrationsCache,
} from '../platform-integrations/platform-integrations.store';
import { PagatgNotifier, type PagatgCreditPayload } from './pagatg-notifier';

async function configure(values: Record<string, string>) {
  await initializePlatformIntegrationsCache({
    platformIntegration: {
      findMany: async () =>
        Object.entries(values).map(([key, url]) => ({
          key,
          url,
          encryptedValue: null,
          platform: { tag: 'PAGATG' },
        })),
    },
  } as never);
}

const payload: PagatgCreditPayload = {
  code: 'PX-ABC123',
  email: 'buyer@test.dev',
  customerId: 'c1',
  status: 'COMPLETED',
  userId: 'u1',
};

describe('PagatgNotifier', () => {
  beforeEach(() => invalidatePlatformIntegrationsCache());

  it('posts the legacy body and internal token header to /webhook/pix-credit', async () => {
    await configure({
      BACKEND_URL: 'https://api.pagatg.example.com/',
      INTERNAL_TOKEN: 'secret',
    });
    const calls: any[] = [];
    const n = new PagatgNotifier();
    n.fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    };
    expect(await n.notify(payload)).toBe(true);
    expect(calls[0].url).toBe(
      'https://api.pagatg.example.com/webhook/pix-credit',
    );
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-pagatg-internal-token': 'secret',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual(payload);
  });

  it('never throws when the request fails or answers an error', async () => {
    await configure({ BACKEND_URL: 'https://api.pagatg.example.com' });
    const n = new PagatgNotifier();
    n.fetchImpl = async () => {
      throw new Error('boom');
    };
    expect(await n.notify(payload)).toBe(false);
    n.fetchImpl = async () => ({ ok: false, status: 502 });
    expect(await n.notify(payload)).toBe(false);
  });

  it('refuses internal addresses (SSRF) without calling out', async () => {
    let called = false;
    const n = new PagatgNotifier();
    n.fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    for (const url of [
      'http://169.254.169.254',
      'http://localhost:3000',
      'http://10.0.0.5',
      'ftp://pagatg.example.com',
    ]) {
      await configure({ BACKEND_URL: url });
      expect(await n.notify(payload)).toBe(false);
    }
    expect(called).toBe(false);
  });

  it('does nothing without a configured backend url', async () => {
    await configure({});
    let called = false;
    const n = new PagatgNotifier();
    n.fetchImpl = async () => {
      called = true;
      return { ok: true, status: 200 };
    };
    expect(await n.notify(payload)).toBe(false);
    expect(called).toBe(false);
  });
});
