import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('admin associates additive fee, sees effective merchant fee and coverage, saves in PATCH', async () => {
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
    const fee = (id, name, percentageValue, fixedValue, associated) => ({
      id,
      name,
      applicationScope: 'order',
      displayMode: 'checkout_only',
      percentageValue,
      fixedValue,
      active: true,
      associated,
      percentageOverride: null,
      fixedOverride: null,
      effectivePercentageValue: percentageValue,
      effectiveFixedValue: fixedValue,
    });
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
      additiveFees: [
        fee('a', 'Serviço', 50, 0, true),
        fee('b', 'Entrega', 100, 100, false),
      ],
    };
    let patch;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      if (request.url().endsWith('/platforms/acquirers'))
        return route.fulfill({
          json: { data: [{ code: 'DOM', name: 'DOM Pagamentos' }] },
        });
      if (request.method() === 'GET')
        return route.fulfill({ json: { data: configuration } });
      if (request.method() === 'PATCH') {
        patch = request.postDataJSON();
        return route.fulfill({ json: { data: configuration } });
      }
      return route.fulfill({
        json: { data: [{ installments: 1, error: 'sem simulação' }] },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?admin`);
    await page.getByText('Taxas adicionais', { exact: true }).waitFor();
    await page.getByText('Serviço', { exact: true }).waitFor();
    const card = page.getByRole('article').first();
    expect(await card.innerText()).toContain('Taxa efetiva do lojista');
    expect(await card.innerText()).toContain('1,5%');
    await card
      .getByRole('alert')
      .filter({ hasText: 'Cobertura insuficiente' })
      .waitFor();
    await page.getByRole('combobox', { name: 'Associar taxa' }).click();
    await page.getByRole('option', { name: /Entrega/ }).click();
    await page.getByRole('button', { name: 'Associar', exact: true }).click();
    await card.getByText('Cobre o custo da adquirente').waitFor();
    expect(await card.innerText()).toContain('2,5%');
    expect(await card.innerText()).not.toContain('Não aplicado');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 50 && patch === undefined; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(patch.additiveFees).toEqual([{ feeId: 'b', associated: true }]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
