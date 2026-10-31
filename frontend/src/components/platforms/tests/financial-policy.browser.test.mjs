import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('incremental simulation, stale responses, isolated error, discard and save', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/financial-policy-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
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
    const configuration = {
      version: '1:1',
      keys: Array.from(
        { length: 12 },
        (_, i) => `DOM/CREDIT_CARD/ONLINE/${i + 1}`,
      ),
      owner: {},
      ownerOverrides: {},
      globalOwner: {},
      interestFree: false,
      sources: {},
    };
    const requests = [];
    let failThird = false,
      saved = false;
    await page.route('**/api/**', async (route) => {
      if (route.request().url().endsWith('/platforms/acquirers'))
        return route.fulfill({
          json: { data: [{ code: 'DOM', name: 'DOM Pagamentos' }] },
        });
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: configuration } });
      const body = route.request().postDataJSON();
      if (route.request().method() === 'PATCH') {
        Object.assign(configuration, {
          version: '1:2',
          owner: body.owner,
          ownerOverrides: body.owner,
          interestFree: body.interestFree,
        });
        saved = true;
        return route.fulfill({ json: { data: configuration } });
      }
      requests.push(body);
      const rate =
        body.draft.owner?.['DOM/CREDIT_CARD/ONLINE/2']?.passInterestPpm ?? 0;
      if (rate === 50000)
        await new Promise((resolve) => setTimeout(resolve, 1100));
      const data = body.installments.map((n) => {
        if (n === 3 && failThird)
          return { installments: n, error: 'Falha isolada' };
        const rule = body.draft.owner?.[`DOM/CREDIT_CARD/ONLINE/${n}`];
        const additional = body.draft.interestFree
          ? 0
          : Math.round(
              (body.amountCents * (rule?.passInterestPpm ?? 1_000_000)) /
                1_000_000,
            );
        return {
          installments: n,
          result: {
            installments: n,
            originalCents: body.amountCents,
            buyerAdditionCents: 0,
            buyerInterestCents: additional,
            buyerTotalCents: body.amountCents + additional,
            processingCostCents: 1000,
            interestCostCents: body.amountCents,
            interestRatePpm: 1_000_000,
            buyerInterestRatePpm: body.draft.interestFree
              ? 0
              : (rule?.passInterestPpm ?? 1_000_000),
            contractedCostCents: 1000,
            netCents: body.amountCents + additional - 1000,
            differenceCents: -1000,
          },
        };
      });
      return route.fulfill({ json: { data, version: configuration.version } });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForFunction(
      () =>
        document.querySelectorAll('article').length === 12 &&
        document.querySelectorAll('[aria-label="Calculando"]').length === 0,
    );
    expect(
      await page.getByText('Adquirente contratada', { exact: true }).count(),
    ).toBe(0);
    expect(
      await page
        .getByRole('button', {
          name: 'Herdar opção global de parcelamento sem juros',
        })
        .count(),
    ).toBe(0);
    expect(await page.getByText('Maquineta', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('table').count()).toBe(0);
    expect(
      await page
        .getByRole('article', { name: 'Parcela 1x', exact: true })
        .count(),
    ).toBe(1);
    expect(requests[0].acquirer).toBe('DOM');
    expect(requests[0].installments).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    const firstCard = page.getByRole('article').first();
    expect(await firstCard.innerText()).toContain(
      'Taxa de juros definida (SimIntPay)',
    );
    expect(await firstCard.innerText()).toContain(
      'Taxa de juros repassada (cliente)',
    );
    expect(await firstCard.getByText('100%', { exact: true }).count()).toBe(2);
    expect(
      await firstCard
        .locator('dl > div')
        .filter({ has: page.getByText('Diferença', { exact: true }) })
        .locator('dd')
        .innerText(),
    ).toContain('90,00');
    expect(
      await firstCard.getByText('Repassar juros (%)', { exact: true }).count(),
    ).toBe(1);
    const rate2 = page.locator(
      'input[name="DOM/CREDIT_CARD/ONLINE/2-passInterestPpm"]',
    );
    const firstEdit = page.waitForRequest((request) =>
      request.url().includes('/simulation'),
    );
    await rate2.fill('5');
    const editedRequest = await firstEdit;
    expect(editedRequest.postDataJSON().installments).toEqual([2]);
    expect(
      await page
        .getByRole('article')
        .nth(0)
        .locator('[aria-label="Calculando"]')
        .count(),
    ).toBe(0);
    const secondEdit = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().draft.owner[
          'DOM/CREDIT_CARD/ONLINE/2'
        ]?.passInterestPpm === 70000,
    );
    await rate2.fill('7');
    await secondEdit;
    await page.waitForTimeout(100);
    expect(await page.getByRole('article').nth(1).innerText()).toContain(
      '107,00',
    );
    const difference2 = page
      .getByRole('article')
      .nth(1)
      .locator('dl > div')
      .filter({ has: page.getByText('Diferença', { exact: true }) })
      .locator('dd');
    expect(await difference2.innerText()).toMatch(/-.*3,00/);
    await page.waitForTimeout(1000);
    expect(await difference2.innerText()).toMatch(/-.*3,00/);
    expect(await page.getByRole('article').nth(1).innerText()).toContain(
      '107,00',
    );
    await rate2.fill('');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Resultados anteriores mantidos' })
      .waitFor();
    expect(await page.getByRole('article').nth(0).innerText()).toContain(
      '200,00',
    );
    await rate2.fill('7');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Resultados anteriores mantidos' })
      .waitFor({ state: 'hidden' });
    failThird = true;
    await page
      .locator('input[name="DOM/CREDIT_CARD/ONLINE/3-passInterestPpm"]')
      .fill('2');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Falha isolada' })
      .waitFor();
    expect(await page.getByText('Falha isolada', { exact: true }).count()).toBe(
      1,
    );
    expect(await page.getByRole('article').nth(0).innerText()).toContain(
      '200,00',
    );
    failThird = false;
    const retryResponse = page.waitForResponse((response) =>
      response.url().includes('/simulation'),
    );
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await retryResponse;
    expect(requests.at(-1).installments).toEqual([3]);
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    expect(await rate2.inputValue()).toBe('100');
    const savedSimulation = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().draft.owner[
          'DOM/CREDIT_CARD/ONLINE/2'
        ]?.passInterestPpm === 30000,
    );
    await rate2.fill('3');
    await savedSimulation;
    const savedResponse = page.waitForResponse(
      (response) => response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await savedResponse;
    await page.getByText('Configuração salva', { exact: true }).waitFor();
    expect(saved).toBe(true);
    expect(
      configuration.ownerOverrides['DOM/CREDIT_CARD/ONLINE/2'].passInterestPpm,
    ).toBe(30000);
    const count = requests.length;
    const changedAmount = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().amountCents === 20000,
      { timeout: 15000 },
    );
    await page.locator('input[name="simulation-amount"]').fill('20000');
    await changedAmount;
    expect(requests.length).toBeGreaterThan(count);
    expect(requests.at(-1).installments).toHaveLength(12);
    expect(requests.at(-1).amountCents).toBe(20000);
    expect(await page.locator('input[name$="-fixedCents"]').count()).toBe(0);
    expect(await page.locator('input[name$="-ratePpm"]').count()).toBe(0);
    expect(
      await page.getByRole('combobox', { name: 'Quem paga as taxas?' }).count(),
    ).toBe(0);
    expect(
      await page
        .getByText(/Custos SimIntPay são descontados do seu recebimento/)
        .count(),
    ).toBe(1);
    const beforeInvalid = requests.length;
    await rate2.fill('101');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Resultados anteriores mantidos' })
      .waitFor();
    expect(
      await page
        .getByRole('button', { name: 'Salvar', exact: true })
        .isDisabled(),
    ).toBe(true);
    expect(requests.length).toBe(beforeInvalid);
    await rate2.fill('100');
    await page
      .getByRole('alert')
      .filter({ hasText: 'Resultados anteriores mantidos' })
      .waitFor({ state: 'hidden' });
    const interestFreeResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().draft.owner[
          'DOM/CREDIT_CARD/ONLINE/2'
        ]?.passInterestPpm === 0,
    );
    await page
      .getByRole('button', { name: /Oferecer parcelamento sem juros/ })
      .click();
    await interestFreeResponse;
    expect(requests.at(-1).draft.interestFree).toBe(false);
    await page.waitForFunction(
      () => document.querySelectorAll('[aria-label="Calculando"]').length === 0,
    );
    expect(await rate2.inputValue()).toBe('0');
    expect(await rate2.isDisabled()).toBe(false);
    expect(await firstCard.getByText('0%', { exact: true }).count()).toBe(1);
    const customRate = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().draft.owner[
          'DOM/CREDIT_CARD/ONLINE/2'
        ]?.passInterestPpm === 250000,
    );
    await rate2.fill('25');
    await customRate;
    expect(requests.at(-1).draft.interestFree).toBe(false);
    expect(
      requests.at(-1).draft.owner['DOM/CREDIT_CARD/ONLINE/3'].passInterestPpm,
    ).toBe(0);
    await page
      .getByRole('button', { name: /Oferecer parcelamento sem juros/ })
      .click();
    await page
      .getByRole('button', {
        name: 'Repassar juros do parcelamento',
        exact: true,
      })
      .waitFor();
    await page
      .getByRole('button', {
        name: 'Repassar juros do parcelamento',
        exact: true,
      })
      .click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('input[name$="-passInterestPpm"]')].every(
        (input) => input.value === '100',
      ),
    );
    const bulkResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/simulation') &&
        response.request().postDataJSON().draft.owner[
          'DOM/CREDIT_CARD/ONLINE/2'
        ]?.passInterestPpm === 425000,
    );
    await page
      .locator('input[name="all-installments-passInterestPpm"]')
      .fill('42,5');
    await bulkResponse;
    expect(
      Object.values(requests.at(-1).draft.owner).every(
        (rule) => rule.passInterestPpm === 425000,
      ),
    ).toBe(true);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('article input')].every(
        (input) => input.value === '42,5',
      ),
    );
    await page.getByRole('combobox', { name: 'Modalidade' }).click();
    await page.getByRole('option', { name: 'PIX', exact: true }).click();
    expect(await page.getByRole('table').count()).toBe(0);
    expect(
      await page.locator('article input[name$="-passInterestPpm"]').count(),
    ).toBe(0);
    expect(
      await page.getByRole('button', { name: /Oferecer parcelamento/ }).count(),
    ).toBe(0);
    expect(await page.getByRole('article').count()).toBe(1);
    await page.goto(`http://127.0.0.1:${server.port}/?admin`);
    await page
      .getByRole('combobox', { name: 'Adquirente', exact: true })
      .waitFor();
    expect(await page.locator('input[name$="-passInterestPpm"]').count()).toBe(
      0,
    );
    expect(
      await page
        .getByRole('button', { name: /Oferecer parcelamento sem juros/ })
        .count(),
    ).toBe(0);
    await page
      .getByRole('button', { name: 'Editar taxas', exact: true })
      .first()
      .click();
    await page.getByText('Taxas administrativas', { exact: true }).waitFor();
    expect(
      await page.getByRole('button', { name: /Nova política:/ }).count(),
    ).toBe(0);
    expect(
      await page
        .getByRole('button', { name: 'Salvar no rascunho', exact: true })
        .isEnabled(),
    ).toBe(true);
    expect(
      await page
        .locator('input[name="contract-reference"]')
        .getAttribute('required'),
    ).toBeNull();
    await page.locator('input[name="contract-fixedCents"]').fill('1,50');
    await page.locator('input[name="sim-interestPpm"]').fill('2,5');
    await page
      .getByRole('button', { name: 'Salvar no rascunho', exact: true })
      .click();
    await page
      .getByRole('article')
      .first()
      .getByRole('columnheader', { name: 'Custo adquirente' })
      .waitFor();
    const savedAdmin = page.waitForRequest(
      (request) => request.method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    const adminBody = (await savedAdmin).postDataJSON();
    expect(adminBody.owner).toBeUndefined();
    expect(adminBody.interestFree).toBeUndefined();
    expect(adminBody.lanes['DOM/CREDIT_CARD/ONLINE/1'].sim.interestPpm).toBe(
      25000,
    );
    expect(adminBody.lanes['DOM/CREDIT_CARD/ONLINE/2'].sim.interestPpm).toBe(0);
    expect(
      adminBody.lanes['DOM/CREDIT_CARD/ONLINE/1'].contract.fixedCents,
    ).toBe(150);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 240000);
