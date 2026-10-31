import { test, expect, beforeEach, afterEach } from 'bun:test';
import {
  enableSalePush,
  disableSalePush,
  reconcileSalePushOwner,
  prepareSalePushAccountChange,
} from './sale-push.ts';
const originals = new Map(
  ['window', 'navigator', 'Notification', 'localStorage', 'fetch'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ),
);
let store, removed, requests, permission;
beforeEach(() => {
  store = new Map([
    ['access_token', 'original-token'],
    ['sale_push_owner', 'owner-1'],
  ]);
  removed = 0;
  requests = [];
  permission = 'granted';
  const subscription = {
    endpoint: 'https://push.example/device',
    unsubscribe: async () => {
      removed++;
      return true;
    },
    toJSON: () => ({
      endpoint: 'https://push.example/device',
      keys: { auth: 'auth', p256dh: 'key' },
    }),
  };
  const worker = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => subscription,
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext: true, PushManager: {}, Notification: {} },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        getRegistration: async () => worker,
        register: async () => worker,
        ready: Promise.resolve(worker),
      },
    },
  });
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: { requestPermission: async () => permission },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
  });
  process.env.NEXT_PUBLIC_API_BASE_URL = 'https://api.example';
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: { publicKey: 'AQID' } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
});
afterEach(() => {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});
test('denied permission never registers device', async () => {
  permission = 'denied';
  await expect(enableSalePush('owner-1')).rejects.toThrow('Permissão');
  expect(requests).toHaveLength(0);
});
test('unsupported browser never asks permission or registers device', async () => {
  window.isSecureContext = false;
  await expect(enableSalePush('owner-1')).rejects.toThrow('navegador');
  expect(requests).toHaveLength(0);
});
test('disable authenticates deletion before browser unsubscribe', async () => {
  await disableSalePush();
  expect(removed).toBe(1);
  expect(store.has('sale_push_owner')).toBe(false);
  expect(requests[0].options.method).toBe('DELETE');
  expect(requests[0].options.headers.Authorization).toBe(
    'Bearer original-token',
  );
  expect(JSON.parse(requests[0].options.body).endpoint).toBe(
    'https://push.example/device',
  );
});
test('deletion failure preserves session and browser registration for retry', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'temporary failure' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  await expect(disableSalePush()).rejects.toThrow('temporary failure');
  expect(removed).toBe(0);
  expect(store.get('access_token')).toBe('original-token');
  expect(store.get('sale_push_owner')).toBe('owner-1');
});
test('account swap invalidates previous subscription without associating it', async () => {
  await reconcileSalePushOwner('owner-2');
  expect(removed).toBe(1);
  expect(requests).toHaveLength(0);
  expect(store.has('sale_push_owner')).toBe(false);
});
test('enable persists browser subscription and authenticated owner', async () => {
  await enableSalePush('owner-2');
  expect(store.get('sale_push_owner')).toBe('owner-2');
  expect(requests[1].options.method).toBe('POST');
  expect(JSON.parse(requests[1].options.body).keys.p256dh).toBe('key');
});

test('expired session invalidates old browser endpoint before new login', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  await prepareSalePushAccountChange();
  expect(removed).toBe(1);
  expect(store.has('sale_push_owner')).toBe(false);
});
test('account change with missing token still invalidates old subscription', async () => {
  store.delete('access_token');
  await prepareSalePushAccountChange();
  expect(removed).toBe(1);
  expect(requests).toHaveLength(0);
});
test('temporary cleanup failure blocks account change and preserves device', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: 'temporary failure' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  await expect(prepareSalePushAccountChange()).rejects.toThrow(
    'temporary failure',
  );
  expect(removed).toBe(0);
  expect(store.get('sale_push_owner')).toBe('owner-1');
});
