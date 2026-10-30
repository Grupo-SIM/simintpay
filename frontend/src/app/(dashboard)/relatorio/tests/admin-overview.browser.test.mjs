import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('admin overview includes Grupo SIM transfers without treating them as SimIntPay profit', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/admin-overview-browser-entry.tsx'],
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
        js ? script : '<div id="root"></div><script src="/app.js"></script>',
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
    const page = await browser.newPage();
    const errors = [];
    const legacyBuyerRequests = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.includes('quantidade-usuarios-externos'))
        legacyBuyerRequests.push(path);
      if (path === '/api/auth/me')
        return route.fulfill({
          json: { data: { id: 'admin', isAdmin: true } },
        });
      if (path === '/api/relatorios/financeiro')
        return route.fulfill({
          json: {
            summary: {
              salesCount: 89,
              grossCents: 1050789,
              feesCents: 102529,
              netCents: 948260,
              refundsCount: 0,
              refundsCents: 0,
              chargebacksCount: 0,
              chargebacksCents: 0,
            },
          },
        });
      // Legacy retained-profit fields must not affect the corrected presentation.
      if (path === '/api/admin/relatorios/consolidado')
        return route.fulfill({
          json: {
            totalTransacoes: 89,
            customersCount: 37,
            valorBruto: 10507.89,
            totalRepasseConsolidado: 9482.6,
            totalRepasseReal: 9297.38,
            lucroPlataformasSemRepasse: 185.22,
            lucroSimpayConRepasse: 727.92,
            lucroTotalMaster: 742.92,
          },
        });
      return route.fulfill({ json: { data: [], meses: [], total: 0 } });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByText('R$ 9.482,60', { exact: true }).waitFor();
    expect(
      await page.getByText('Lucro de plataformas', { exact: true }).count(),
    ).toBe(0);
    expect(await page.getByText('R$ 185,22', { exact: true }).count()).toBe(0);
    expect(await page.getByText('R$ 9.297,38', { exact: true }).count()).toBe(
      0,
    );
    expect(await page.getByText('R$ 727,92', { exact: true }).count()).toBe(0);
    expect(
      await page.getByText('Receita Líquida', { exact: true }).count(),
    ).toBe(0);
    expect(
      await page.getByText('Lucro líquido de taxas', { exact: true }).count(),
    ).toBe(0);
    const overview = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Visão Geral', exact: true }),
    });
    expect(
      await overview.getByText('Lucro líquido', { exact: true }).count(),
    ).toBe(1);
    expect(await overview.innerText()).toMatch(
      /ROI[\s\S]*Lucro líquido[\s\S]*742,92/,
    );
    expect(await page.getByText('R$ 742,92', { exact: true }).count()).toBe(1);
    expect(await overview.getByText('37', { exact: true }).count()).toBe(1);
    expect(legacyBuyerRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
