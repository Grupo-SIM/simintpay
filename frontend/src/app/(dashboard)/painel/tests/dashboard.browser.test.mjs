import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('client sees quick cards, October sales chart and chargebacks without administrative requests', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/dashboard-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const js = new URL(request.url).pathname === '/app.js';
      return new Response(
        js
          ? script
          : '<div id="root" style="width:1200px"></div><script src="/app.js"></script>',
        {
          headers: {
            'Content-Type': js ? 'text/javascript' : 'text/html; charset=utf-8',
          },
        },
      );
    },
  });
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN ?? '/opt/google/chrome/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    });
    const calls = [];
    const errors = [];
    let failNext = false;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-20T15:00:00Z') });
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      calls.push(url.pathname + url.search);
      if (
        failNext &&
        url.pathname === '/api/relatorios/financeiro/transacoes'
      ) {
        failNext = false;
        return route.fulfill({
          status: 500,
          json: { message: 'Falha simulada' },
        });
      }
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'grupo-sim',
              name: 'Grupo SIM',
              email: 'contato@example.com',
              isAdmin: false,
              isClient: true,
              clientStatus: 'APPROVED',
              tenantModule: null,
            },
          },
        });
      if (url.pathname === '/api/relatorios/financeiro')
        return route.fulfill({
          json: {
            summary: {
              salesCount: 4,
              grossCents: 100010,
              netCents: 99610,
              refundsCents: 400,
              refundsCount: 1,
              refundedCents: 400,
              refundedCount: 1,
              chargebacksCents: 500,
              chargebacksCount: 2,
            },
          },
        });
      if (url.pathname === '/api/saques')
        return route.fulfill({
          json: { data: [], total: 3, page: 1, pageSize: 1 },
        });
      if (url.pathname === '/api/relatorios/financeiro/transacoes') {
        if (url.searchParams.get('pageSize') === '1')
          return route.fulfill({
            json: { data: [], total: 1, page: 1, pageSize: 1 },
          });
        return route.fulfill({
          json: {
            data: [1, 2, 3, 4].map((id) => ({
              id: String(id),
              platformTag: 'ATLAS',
              createdAt: `2026-10-${String(id + 1).padStart(2, '0')}T15:00:00Z`,
              status: 'COMPLETED',
              paymentMethod: 'PIX',
              grossCents: id * 10001,
              netCents: id * 10001 - 100,
              feesCents: 100,
            })),
            total: 4,
            page: 1,
            pageSize: 100,
          },
        });
      }
      return route.fulfill({
        status: 404,
        json: { message: 'Unexpected request' },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page
      .getByText('Receita líquida (mês atual)', { exact: true })
      .waitFor();
    await page.getByText('R$ 1.000,10', { exact: true }).waitFor();
    await page.getByText('R$ 996,10', { exact: true }).waitFor();
    await page.getByText('Total em chargeback', { exact: true }).waitFor();
    expect(
      await page.getByText('Transações de hoje', { exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByText('Saques pendentes', { exact: true }).count(),
    ).toBe(1);
    expect(await page.locator('.recharts-area-curve').count()).toBe(1);
    expect(
      calls.some(
        (url) =>
          url.includes('/admin/') || url.includes('/relatorios/dashboard'),
      ),
    ).toBe(false);
    expect(
      calls.some(
        (url) =>
          url.includes('startDate=2026-09-21') &&
          url.includes('endDate=2026-10-20'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Selecione o periodo' }).click();
    await page.getByRole('button', { name: '01', exact: true }).first().click();
    await page.getByRole('button', { name: '20', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
    await page.getByText('4 transações pagas', { exact: true }).waitFor();
    expect(
      calls.some(
        (url) =>
          url.includes('startDate=2026-10-01') &&
          url.includes('endDate=2026-10-20') &&
          url.includes('pageSize=100'),
      ),
    ).toBe(true);
    failNext = true;
    await page.getByRole('button', { name: '7 dias', exact: true }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByText('R$ 0,00', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByText('4 transações pagas', { exact: true }).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
