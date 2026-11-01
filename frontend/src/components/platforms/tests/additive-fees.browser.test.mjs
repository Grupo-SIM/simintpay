import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('admin edits additive totals, effective merchant fee and coverage', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/financial-policy-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
      'process.env.NEXT_PUBLIC_CLIENT_MIN_AMOUNT': '"14.99"',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/app.js'
          ? script
          : '<div id="root"></div><script src="/app.js"></script>',
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
    executablePath: process.env.CHROME_BIN ?? '/opt/google/chrome/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const totals = (order, product = [0, 0]) => ({
      order: { percentageValue: order[0], fixedValue: order[1] },
      product: { percentageValue: product[0], fixedValue: product[1] },
    });
    const view = (effective) => ({ effective, revision: '1' });
    const key = 'DOM/CREDIT_CARD/ONLINE/1';
    const lane = {
      active: true,
      contract: {
        fixedCents: 50,
        ratePpm: 20000,
        cashbackCents: 0,
        interestPpm: 0,
        base: 'ORIGINAL',
        reference: '',
      },
      sim: { fixedCents: 0, ratePpm: 10000, interestPpm: 0 },
    };
    const configuration = {
      version: '1:1',
      feeMode: 'BOTH',
      disabledLanes: [],
      keys: [key],
      owner: {},
      ownerOverrides: {},
      globalOwner: {},
      laneOverrides: { [key]: lane },
      interestFree: false,
      sources: {},
      additiveFees: view(totals([50, 0])),
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.url().endsWith('/platforms/acquirers'))
        return route.fulfill({
          json: { data: [{ code: 'DOM', name: 'DOM Pagamentos' }] },
        });
      if (request.method() === 'GET')
        return route.fulfill({ json: { data: configuration } });
      return route.fulfill({
        json: { data: [{ installments: 1, error: 'sem simulação' }] },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?admin`);
    await page.getByText('Taxas adicionais', { exact: true }).waitFor();
    const card = page.getByRole('article').first();
    expect(await card.innerText()).toContain('Taxa efetiva do lojista');
    expect(await card.innerText()).toContain('1,5%');
    await card
      .getByRole('alert')
      .filter({ hasText: 'Cobertura insuficiente' })
      .waitFor();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Gerenciadas no SIM Delivery');
    expect(body).not.toContain('Definidas na SimIntPay');
    expect(
      await page
        .getByRole('button', { name: 'Restaurar total do Delivery' })
        .count(),
    ).toBe(0);
    // Editing changes actual generic totals, with no origin or restore affordance.
    await page.getByLabel('Percentual (%)').first().fill('1,5');
    await page.getByLabel('Valor fixo (R$)').first().fill('1,00');
    await card.getByText('Cobre o custo da adquirente').waitFor();
    expect(await card.innerText()).toContain('2,5%');
    expect(
      await page
        .getByRole('button', { name: 'Restaurar total do Delivery' })
        .count(),
    ).toBe(0);
    await page.screenshot({
      path: '/tmp/simintpay-generic-additive-fees.png',
      fullPage: true,
    });
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
