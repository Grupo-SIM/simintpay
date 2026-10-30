import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../../public/sale-push-sw.js', import.meta.url),
  'utf8',
);

function worker(clients = []) {
  const handlers = {};
  const notifications = [];
  const opened = [];
  vm.runInNewContext(source, {
    URL,
    Intl,
    Number,
    self: {
      location: { origin: 'https://local.example' },
      addEventListener: (name, handler) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (...args) => {
          notifications.push(args);
        },
      },
      clients: {
        matchAll: async () => clients,
        openWindow: async (url) => opened.push(url),
      },
    },
  });
  return { handlers, notifications, opened };
}

test('push shows approved value and sale tag, without buyer data', async () => {
  const { handlers, notifications } = worker();
  let pending;
  handlers.push({
    data: {
      json: () => ({
        saleId: 'sale-1',
        amount: '14.99',
        buyer: 'Private name',
      }),
    },
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.equal(notifications[0][0], 'Venda aprovada');
  assert.equal(notifications[0][1].tag, 'sale-sale-1');
  assert.match(notifications[0][1].body, /14,99/);
  assert.equal(JSON.stringify(notifications).includes('Private name'), false);
});

test('malformed push is ignored', () => {
  const { handlers, notifications } = worker();
  handlers.push({
    data: {
      json: () => {
        throw new Error('malformed');
      },
    },
  });
  handlers.push({
    data: { json: () => ({ saleId: 'sale-1', amount: 'invalid' }) },
  });
  assert.equal(notifications.length, 0);
});

test('click opens transactions when dashboard is closed and ignores supplied URLs', async () => {
  const { handlers, opened } = worker();
  let pending;
  let closed = false;
  handlers.notificationclick({
    notification: {
      data: { url: 'https://external.example' },
      close: () => {
        closed = true;
      },
    },
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.equal(closed, true);
  assert.deepEqual(opened, ['https://local.example/transacoes']);
});

test('click navigates and focuses an existing dashboard window', async () => {
  const visits = [];
  const { handlers, opened } = worker([
    {
      url: 'https://local.example/painel',
      navigate: async (url) => visits.push(url),
      focus: async () => visits.push('focus'),
    },
  ]);
  let pending;
  handlers.notificationclick({
    notification: { close() {} },
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(visits, ['https://local.example/transacoes', 'focus']);
  assert.equal(opened.length, 0);
});
