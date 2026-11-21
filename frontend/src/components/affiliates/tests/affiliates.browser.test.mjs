import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

async function serve() {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const css = process.env.AFFILIATES_SCREENSHOT_CSS
    ? await Bun.file(process.env.AFFILIATES_SCREENSHOT_CSS).text()
    : '';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/app.js'
          ? script
          : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`,
        {
          headers: {
            'Content-Type':
              new URL(request.url).pathname === '/app.js'
                ? 'text/javascript'
                : 'text/html; charset=utf-8',
          },
        },
      ),
  });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-gpu'],
  });
  return { server, browser };
}

const me = {
  data: {
    id: 'owner',
    email: 'owner@local.test',
    isAdmin: false,
    clientStatus: 'APPROVED',
  },
};

test('affiliate view shows code, link, sales and pending/credited/reverted commission, and hides when empty', async () => {
  const { server, browser } = await serve();
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(30000);
      let empty = false;
      const pages = [];
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (!url.pathname.startsWith('/api')) return route.continue();
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: me });
        pages.push(url.searchParams.get('page'));
        return route.fulfill({
          json: empty
            ? {
                data: [],
                summary: { creditedCents: 0, lockedCents: 0, reversedCents: 0 },
                total: 0,
                page: 1,
                pageSize: 20,
              }
            : {
                data: [
                  {
                    transactionId: 't1',
                    amountCents: 1234,
                    state: 'AVAILABLE',
                    createdAt: '2026-10-02T12:00:00Z',
                    originName: 'Curso',
                    isRenewal: true,
                  },
                  {
                    transactionId: 't2',
                    amountCents: 500,
                    state: 'REVERSED',
                    createdAt: '2026-10-03T12:00:00Z',
                    originName: null,
                  },
                ],
                summary: {
                  creditedCents: 1234,
                  lockedCents: 800,
                  reversedCents: 500,
                },
                affiliations: [
                  {
                    code: 'ANA123',
                    platformName: 'Loja',
                    linkBaseUrl: 'https://loja.test',
                  },
                ],
                total: 2,
                page: 1,
                pageSize: 20,
              },
        });
      });
      await page.goto(server.url + '?view=receipts');
      await page.getByText('ANA123').waitFor();
      await page.getByText('R$ 12,34').first().waitFor();
      await page.getByText('R$ 8,00').waitFor();
      await page.getByText('R$ 5,00').first().waitFor();
      await page.getByText('Curso (renovação)').waitFor();
      expect(
        await page.getByRole('button', { name: 'Copiar link' }).count(),
      ).toBe(1);
      expect(pages[0]).toBe('1');
      if (process.env.AFFILIATES_SCREENSHOT_CSS)
        await page.screenshot({
          path: `/tmp/affiliates-view-${viewport.width}.png`,
          fullPage: true,
        });
      empty = true;
      await page.goto(server.url + '?view=receipts');
      await page.waitForLoadState('networkidle');
      expect(
        await page
          .getByRole('region', { name: 'Recebimentos de afiliado' })
          .count(),
      ).toBe(0);
      await page.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
