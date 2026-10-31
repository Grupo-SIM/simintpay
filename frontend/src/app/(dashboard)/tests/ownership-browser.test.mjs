import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('five creation forms expose admin beneficiary and optional personal platform', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/ownership-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"http://127.0.0.1:4329/api"',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [
      {
        name: 'local-navigation',
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: import.meta.dir + '/navigation-fixture.ts',
          }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({
            path: 'local-link',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            loader: 'js',
            contents:
              'import { createElement } from "react"; export default function Link({children, ...props}) { return createElement("a", props, children); }',
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const stylesheet = import.meta.dir + '/../../globals.css';
  const styles = (
    await postcss([tailwind()]).process(await Bun.file(stylesheet).text(), {
      from: stylesheet,
    })
  ).css;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      return new Response(
        path === '/app.js'
          ? script
          : path === '/style.css'
            ? styles
            : '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
        {
          headers: {
            'Content-Type':
              path === '/app.js'
                ? 'text/javascript'
                : path === '/style.css'
                  ? 'text/css'
                  : 'text/html; charset=utf-8',
          },
        },
      );
    },
  });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking'],
  });
  const context = await browser.newContext();
  let admin = true;
  const errors = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/'))
      return url.port === '4329'
        ? route.fulfill({ body: '' })
        : route.continue();
    const path = url.pathname.slice(4);
    if (path === '/auth/me')
      return route.fulfill({
        json: {
          data: {
            id: admin ? 'admin' : 'owner',
            name: 'Conta local',
            email: 'local@test.local',
            isAdmin: admin,
            isMasterAdmin: admin,
            isClient: !admin,
            clientStatus: 'APPROVED',
          },
        },
      });
    if (path === '/platforms')
      return route.fulfill({
        json: {
          data: [
            {
              tag: 'SHOP',
              name: 'Loja',
              isActive: true,
              ownerUserId: 'owner',
              owner: { id: 'owner', name: 'Maria' },
            },
            {
              tag: 'OTHER',
              name: 'Outra',
              isActive: true,
              ownerUserId: 'owner',
            },
          ],
        },
      });
    if (path === '/admin/users')
      return route.fulfill({
        json: {
          data: [
            {
              id: 'owner',
              name: 'Maria',
              email: 'maria@test.local',
              isAdmin: false,
            },
            {
              id: 'admin',
              name: 'Admin',
              email: 'admin@test.local',
              isAdmin: true,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    return route.fulfill({
      json: { data: [], total: 0, page: 1, pageSize: 20 },
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    for (let product = 0; product < 5; product++) {
      await page.goto(`http://127.0.0.1:${server.port}/?product=${product}`);
      await page
        .getByText('Selecione uma conta', { exact: true })
        .waitFor({ state: 'visible' });
      await page.getByText('Selecione uma conta', { exact: true }).click();
      expect(await page.getByRole('option', { name: /Admin/ }).count()).toBe(0);
      await page.getByText('Maria', { exact: true }).click();
      expect(
        await page.getByText('Maria', { exact: true }).count(),
      ).toBeGreaterThan(0);
      await page.screenshot({
        path: `/tmp/ownership-admin-${product}.png`,
        fullPage: true,
      });
    }
    admin = false;
    await page.goto(`http://127.0.0.1:${server.port}/?product=0`);
    await page
      .getByText('Venda pessoal (sem plataforma)', { exact: true })
      .waitFor({ state: 'visible' });
    expect(
      await page.getByText('Selecione uma conta', { exact: true }).count(),
    ).toBe(0);
    await page.screenshot({
      path: '/tmp/ownership-client-personal.png',
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
