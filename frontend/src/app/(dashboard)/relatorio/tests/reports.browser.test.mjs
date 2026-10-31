import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('owner scope, searchable database catalog, inactive history, pagination, failures and identity isolation', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/report-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
      'process.env': '{}',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [
      {
        name: 'navigation',
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: import.meta.dir + '/navigation-mock.ts',
          }));
        },
      },
    ],
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
          : '<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}[cmdk-list]{max-height:300px;overflow:auto}</style><div id="root"></div><script src="/app.js"></script>',
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
    let identity = 'owner-a',
      fail = false,
      revoked = false,
      noPlatforms = false;
    const calls = [],
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const catalog = Array.from({ length: 25 }, (_, i) => ({
      id: `${identity}-${i}`,
      tag: `SHOP-${i}`,
      name: `Loja ${String(i).padStart(2, '0')}`,
      isActive: i !== 0,
    }));
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      calls.push({
        identity,
        path: url.pathname,
        query: url.searchParams.toString(),
      });
      if (url.pathname === '/api/coproducao/recebimentos')
        return route.fulfill({
          json: {
            data: [],
            summary: { creditedCents: 0, lockedCents: 0, reversedCents: 0 },
            total: 0,
            page: 1,
            pageSize: 10,
          },
        });
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: identity,
              name: identity,
              email: `${identity}@test.local`,
              isAdmin: false,
              isClient: true,
              tenantModule: null,
            },
          },
        });
      if (url.pathname === '/api/relatorios/plataformas') {
        const search = url.searchParams.get('search') ?? '',
          page = Number(url.searchParams.get('page') ?? 1);
        const matches = (noPlatforms ? [] : catalog).filter((p) =>
          p.name.toLowerCase().includes(search.toLowerCase()),
        );
        return route.fulfill({
          json: {
            data: matches.slice((page - 1) * 20, page * 20),
            total: matches.length,
            page,
            pageSize: 20,
          },
        });
      }
      if (url.pathname.includes('/admin/'))
        return route.fulfill({
          status: 403,
          json: { message: 'Admin forbidden' },
        });
      if (
        url.pathname.endsWith('/transacoes') &&
        url.searchParams.get('pageSize') === '100'
      )
        return route.fulfill({
          json: { data: [], total: 0, page: 1, pageSize: 100 },
        });
      if (url.pathname.endsWith('/transacoes'))
        return route.fulfill({
          json: {
            data: [
              {
                id: 'sale-1',
                platformTag: 'SHOP-0',
                createdAt: '2026-10-10T12:00:00Z',
                status: 'COMPLETED',
                paymentMethod: 'PIX',
                grossCents: 4100,
                feesCents: 33,
                netCents: 4067,
              },
            ],
            total: 3,
            page: 1,
            pageSize: 20,
          },
        });
      if (
        ['/mensal', '/metodos', '/status'].some((s) => url.pathname.endsWith(s))
      )
        return route.fulfill({
          json: {
            unit: 'cents',
            data: [
              {
                key: url.pathname.endsWith('/mensal')
                  ? '2026-10'
                  : url.pathname.endsWith('/metodos')
                    ? 'PIX'
                    : 'COMPLETED',
                count: 3,
                grossCents: 12300,
                netCents: 12200,
              },
            ],
          },
        });
      if (
        revoked &&
        url.searchParams.has('platform') &&
        url.pathname === '/api/relatorios/financeiro'
      )
        return route.fulfill({
          status: 403,
          json: { message: 'Plataforma transferida' },
        });
      if (fail)
        return route.fulfill({
          status: 500,
          json: { message: 'Erro simulado' },
        });
      return route.fulfill({
        json: {
          unit: 'cents',
          platformsCount: noPlatforms ? 0 : 25,
          summary: {
            salesCount: identity === 'owner-a' ? 3 : 8,
            grossCents: identity === 'owner-a' ? 12300 : 99900,
            feesCents: 100,
            netCents: 12200,
            refundsCents: 0,
            refundsCount: 0,
            withdrawalsCents: 0,
            withdrawalFeesCents: 545,
            interestCents: null,
            pendingWithdrawalsCents: 0,
            missingNetSnapshots: 0,
            historicalAttributionComplete: true,
          },
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByText('R$ 123,00', { exact: true }).first().waitFor();
    const costs = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Custos', exact: true }),
    });
    expect(
      await costs.getByText('Taxa de saque', { exact: true }).count(),
    ).toBe(1);
    expect(await costs.getByText('R$ 5,45', { exact: true }).count()).toBe(1);
    expect(await costs.getByText('R$ 0,00', { exact: true }).count()).toBe(1);
    expect(
      await costs.getByText('Não informado', { exact: true }).count(),
    ).toBe(0);
    expect(await page.getByRole('tab').count()).toBe(0);
    expect(
      await page
        .getByRole('heading', { name: 'Visão Geral', exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page.getByRole('heading', { name: 'Custos', exact: true }).count(),
    ).toBe(1);
    expect(
      await page
        .getByRole('heading', { name: 'Taxas DOM', exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByRole('tab', { name: 'Saldos por Plataforma', exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page.getByText('Total de taxas SimIntPay', { exact: true }).count(),
    ).toBe(1);

    expect(calls.some((c) => c.path.includes('/admin/'))).toBe(false);
    await page.getByRole('cell', { name: 'R$ 40,67', exact: true }).waitFor();
    expect(
      await page.getByRole('cell', { name: 'R$ 41,00', exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByRole('cell', { name: 'R$ 0,33', exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByRole('cell', { name: 'Aprovada', exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByRole('cell', { name: 'Aprovada', exact: true }).count(),
    ).toBe(1);
    expect(
      await page.getByRole('cell', { name: 'PIX', exact: true }).count(),
    ).toBe(2);
    expect(
      calls
        .filter((c) => /\/(mensal|metodos|status|transacoes)$/.test(c.path))
        .every(
          (c) => c.query.includes('startDate=') && c.query.includes('endDate='),
        ),
    ).toBe(true);

    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Próxima', exact: true })
      .last()
      .click();
    await page.getByRole('option', { name: 'Loja 20', exact: true }).waitFor();
    const search = page.getByRole('combobox', {
      name: 'Pesquisar plataforma',
      exact: true,
    });
    await search.fill('Loja 00');
    await page
      .getByRole('option', { name: 'Loja 00 (Inativa)', exact: true })
      .waitFor();
    expect(
      calls.some(
        (c) =>
          c.path === '/api/relatorios/plataformas' &&
          c.query.includes('search=Loja+00') &&
          c.query.includes('page=1'),
      ),
    ).toBe(true);
    await search.press('ArrowDown');
    await search.press('Enter');
    await page.getByText('R$ 123,00', { exact: true }).first().waitFor();
    expect(
      calls.some(
        (c) =>
          c.path === '/api/relatorios/financeiro' &&
          c.query.includes('platform=SHOP-0'),
      ),
    ).toBe(true);
    expect(
      calls
        .filter((c) => /\/(mensal|metodos|status|transacoes)$/.test(c.path))
        .slice(-4)
        .every((c) => c.query.includes('platform=SHOP-0')),
    ).toBe(true);
    identity = 'owner-b';
    fail = true;
    await page.getByRole('button', { name: 'Trocar sessão' }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível carregar' })
      .waitFor();
    expect(await page.getByText('R$ 123,00', { exact: true }).count()).toBe(0);
    fail = false;
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await page.getByText('R$ 999,00', { exact: true }).first().waitFor();
    expect(
      calls.some(
        (c) =>
          c.identity === 'owner-b' && c.path === '/api/relatorios/financeiro',
      ),
    ).toBe(true);
    expect(calls.some((c) => c.path.includes('/admin/'))).toBe(false);
    revoked = true;
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Loja 00 (Inativa)', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Acesso à plataforma mudou' })
      .waitFor();
    revoked = false;
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page
      .getByRole('combobox', { name: 'Pesquisar plataforma', exact: true })
      .fill('Loja 01');
    await page.getByRole('option', { name: 'Loja 01', exact: true }).click();
    await page.getByText('R$ 999,00', { exact: true }).first().waitFor();
    expect(
      await page
        .getByRole('alert')
        .filter({ hasText: 'Acesso à plataforma mudou' })
        .count(),
    ).toBe(0);
    noPlatforms = true;
    identity = 'owner-empty';
    await page.getByRole('button', { name: 'Trocar sessão' }).click();
    await page
      .getByText('Nenhuma plataforma própria disponível para relatório.', {
        exact: true,
      })
      .waitFor();
    expect(await page.getByRole('tab').count()).toBe(0);
    expect(
      await page
        .getByRole('region', { name: 'Recebimentos de coprodução' })
        .count(),
    ).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('admin unified report retains balances, paginated balances and database-only product selection', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/report-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
      'process.env': '{}',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [
      {
        name: 'navigation',
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: import.meta.dir + '/navigation-mock.ts',
          }));
        },
      },
    ],
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
          : '<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style><div id="root"></div><script src="/app.js"></script>',
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
    const page = await browser.newPage(),
      calls = [],
      errors = [];
    let failBalances = true,
      failBreakdown = false;
    page.on('pageerror', (error) => errors.push(error.message));
    const platform = {
      id: 'new-platform',
      tag: 'NEW-PLATFORM',
      name: 'A Plataforma Nova',
      isActive: false,
    };
    const balance = {
      ...platform,
      owner: { id: 'owner', name: 'Dono', email: 'owner@test.local' },
      balanceCents: -1000,
      availableBalanceCents: 0,
      pendingWithdrawalsGrossCents: 500,
      earnedCents: 1000,
      withdrawnGrossCents: 2000,
      ownerWalletBalanceCents: 90000,
      walletScope: 'shared-owner',
      historicalAttributionComplete: false,
    };
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.pathname + url.search);
      if (url.pathname === '/api/coproducao/recebimentos')
        return route.fulfill({
          json: {
            data: [],
            summary: { creditedCents: 0, lockedCents: 0, reversedCents: 0 },
            total: 0,
            page: 1,
            pageSize: 10,
          },
        });
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'admin',
              name: 'Admin',
              email: 'admin@test.local',
              isAdmin: true,
              tenantModule: null,
            },
          },
        });
      if (url.pathname === '/api/admin/relatorios/saldos-plataformas') {
        if (failBalances)
          return route.fulfill({
            status: 500,
            json: { message: 'Falha de teste' },
          });
        return route.fulfill({
          json: {
            data: [
              url.searchParams.get('page') === '2'
                ? { ...balance, id: 'z-platform', name: 'Z Plataforma' }
                : balance,
            ],
            page: Number(url.searchParams.get('page')),
            pageSize: 12,
            total: 13,
          },
        });
      }
      if (url.pathname === '/api/admin/relatorios/consolidado/transacoes')
        return route.fulfill({
          json: {
            data: [
              {
                id: 'admin-sale',
                plataformaTag: 'ZERO-GRAU',
                valor: 987.65,
                valorLiquido: 978.65,
                status: 'Aprovado',
                metodo: 'PIX',
                descricao: 'Venda consolidada',
                criadoEm: '2026-10-10T12:00:00Z',
                cliente: { nome: 'Cliente Teste' },
                taxas: { total: 9 },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        });
      if (url.pathname.endsWith('/plataforma-consolidado'))
        return failBreakdown
          ? route.fulfill({ status: 500, json: { message: 'Indisponível' } })
          : route.fulfill({
              json: {
                qtdTransacoes: 89,
                receitaTotal: 10507.89,
                totalRepasse: 9297.38,
                taxaDomPct: 225.62,
                taxaDomFixa: 89,
                taxaDomCashback: 267,
                totalTaxasDom: 581.62,
                taxaSimIntPctNet: 101,
                taxaSimIntPctBruta: 682.62,
                taxaSimIntFixa: 356,
                totalTaxasSimInt: 457,
                taxaParcelamentoBruto: 40,
                taxaParcelamentoSimIntPay: 10,
                parcBruto: 300,
                parcRepasse: 260,
              },
            });
      if (url.pathname === '/api/relatorios/plataformas')
        return route.fulfill({
          json: { data: [platform], total: 1, page: 1, pageSize: 20 },
        });
      if (
        url.pathname.includes('/produto') &&
        !url.pathname.endsWith('/transacoes')
      )
        return route.fulfill({
          json: {
            platformsCount: 1,
            summary: {
              salesCount: 1,
              grossCents: 10000,
              feesCents: 1000,
              netCents: 9000,
              refundsCents: 0,
              withdrawalsCents: 0,
              pendingWithdrawalsCents: 0,
              historicalAttributionComplete: true,
            },
          },
        });
      if (url.pathname === '/api/relatorios/financeiro')
        return route.fulfill({
          json: {
            platformsCount: 1,
            summary: {
              salesCount: 1,
              grossCents: 10000,
              feesCents: 1000,
              netCents: 9000,
              refundsCents: 0,
              refundsCount: 0,
              withdrawalsCents: 0,
              pendingWithdrawalsCents: 0,
              historicalAttributionComplete: true,
            },
          },
        });
      return route.fulfill({
        json: { data: [], meses: [], items: [], total: 0 },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByText('Venda consolidada', { exact: true }).waitFor();
    expect(
      await page.getByRole('cell', { name: 'R$ 987,65', exact: true }).count(),
    ).toBe(1);
    expect(
      calls.some(
        (url) =>
          url.startsWith('/api/admin/relatorios/consolidado/transacoes?') &&
          url.includes('dataInicio=') &&
          url.includes('dataFim='),
      ),
    ).toBe(true);
    expect(
      calls.some((url) => url.startsWith('/api/coproducao/recebimentos')),
    ).toBe(false);

    await page
      .getByRole('tab', { name: 'Saldos por Plataforma', exact: true })
      .click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível carregar' })
      .waitFor();
    expect(
      await page.getByText('Disponível projetado', { exact: true }).count(),
    ).toBe(0);
    failBalances = false;
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await page
      .getByRole('button')
      .filter({ hasText: 'A Plataforma Nova (Inativa)' })
      .click();
    await page
      .getByText('Carteira compartilhada do dono', { exact: true })
      .waitFor();
    expect(await page.getByText('R$ 900,00', { exact: true }).count()).toBe(1);
    expect(await page.getByText(/-.*10,00/).count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Próxima', exact: true }).click();
    await page.getByText('Z Plataforma (Inativa)', { exact: true }).waitFor();
    expect(
      calls.some((url) =>
        url.includes('saldos-plataformas?page=2&pageSize=12'),
      ),
    ).toBe(true);
    await page
      .getByRole('tab', { name: 'Relatório Financeiro', exact: true })
      .click();
    expect(await page.getByRole('tab').count()).toBe(2);
    expect(
      await page.getByRole('tab', { name: 'Relatório por Produto' }).count(),
    ).toBe(0);
    expect(
      await page.getByRole('button', { name: 'PagaTG', exact: true }).count(),
    ).toBe(0);
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page
      .getByRole('option', { name: /A Plataforma Nova.*Inativa/ })
      .click();
    await page.getByText('R$ 100,00', { exact: true }).first().waitFor();
    expect(
      calls.some((url) =>
        url.includes('/relatorios/plataformas/NEW-PLATFORM/produto'),
      ),
    ).toBe(true);
    await page
      .getByRole('combobox', { name: 'Método de pagamento', exact: true })
      .click();
    const filteredCustomPlatform = page.waitForRequest(
      (request) =>
        request.url().includes('/NEW-PLATFORM/produto?') &&
        new URL(request.url()).searchParams.get('paymentMethod') === 'PIX',
    );
    await page.getByRole('option', { name: 'PIX', exact: true }).click();
    expect(
      new URL((await filteredCustomPlatform).url()).searchParams.get(
        'paymentMethod',
      ),
    ).toBe('PIX');
    Object.assign(platform, {
      id: 'zero',
      tag: 'ZERO-GRAU',
      name: 'Zero Grau',
      isActive: true,
    });
    await page.reload();
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page.getByRole('option', { name: /Zero Grau/ }).click();
    await page
      .getByRole('heading', { name: 'Taxas DOM', exact: true })
      .waitFor();
    expect(
      await page.getByText('R$ 10.507,89', { exact: true }).count(),
    ).toBeGreaterThan(0);
    expect(
      await page.getByText('R$ 9.297,38', { exact: true }).count(),
    ).toBeGreaterThan(0);
    expect(
      await page
        .getByRole('heading', { name: 'Parcelamento', exact: true })
        .count(),
    ).toBe(1);
    expect(calls.some((url) => url.includes('tag=ZERO-GRAU'))).toBe(true);
    expect(
      await page.getByText('Período do produto', { exact: true }).count(),
    ).toBe(0);
    failBreakdown = true;
    await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível carregar' })
      .waitFor();
    expect(await page.getByText('R$ 10.507,89', { exact: true }).count()).toBe(
      0,
    );
    failBreakdown = false;
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Taxas DOM', exact: true })
      .waitFor();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('owner profit chart loads every page, preserves filters and retries without showing partial totals', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/report-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
      'process.env': '{}',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [
      {
        name: 'navigation',
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: import.meta.dir + '/navigation-mock.ts',
          }));
        },
      },
    ],
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
          : '<style>[data-slot="chart"]{height:280px;width:900px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}</style><div id="root"></div><script src="/app.js"></script>',
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
    const page = await browser.newPage(),
      calls = [];
    let fail = true;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T12:00:00Z`;
    const sales = Array.from({ length: 101 }, (_, index) => ({
      id: `sale-${index}`,
      platformTag: index === 100 ? 'ATLAS' : 'RENOVADA',
      createdAt: day,
      status: 'COMPLETED',
      paymentMethod: 'PIX',
      grossCents: 1200,
      feesCents: 200,
      netCents: index === 100 ? -500 : 1000,
    }));
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      calls.push(url);
      if (url.pathname === '/api/coproducao/recebimentos')
        return route.fulfill({
          json: {
            data: [],
            summary: { creditedCents: 0, lockedCents: 0, reversedCents: 0 },
            total: 0,
            page: 1,
            pageSize: 10,
          },
        });
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: { id: 'owner', name: 'Dono', isAdmin: false, isClient: true },
          },
        });
      if (url.pathname === '/api/relatorios/plataformas')
        return route.fulfill({
          json: {
            data: [
              { id: 'atlas', tag: 'ATLAS', name: 'Atlas', isActive: true },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        });
      if (url.pathname.endsWith('/transacoes')) {
        const number = Number(url.searchParams.get('page')),
          size = Number(url.searchParams.get('pageSize'));
        if (fail && number === 2 && size === 100)
          return route.fulfill({
            status: 500,
            json: { message: 'Falha simulada' },
          });
        const filtered = url.searchParams.has('platform')
          ? sales.slice(100)
          : sales;
        return route.fulfill({
          json: {
            data: filtered.slice((number - 1) * size, number * size),
            total: filtered.length,
            page: number,
            pageSize: size,
          },
        });
      }
      if (
        ['/mensal', '/metodos', '/status'].some((suffix) =>
          url.pathname.endsWith(suffix),
        )
      )
        return route.fulfill({ json: { data: [] } });
      return route.fulfill({
        json: {
          platformsCount: 2,
          summary: {
            salesCount: 101,
            grossCents: 121200,
            netCents: 99500,
            feesCents: 20200,
            refundsCents: 0,
            refundsCount: 0,
            historicalAttributionComplete: true,
          },
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page
      .getByRole('alert')
      .filter({ hasText: 'Não foi possível carregar' })
      .waitFor();
    expect(
      await page
        .getByRole('region', { name: 'Lucro bruto por plataforma' })
        .count(),
    ).toBe(0);
    fail = false;
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .click();
    const chart = page.getByRole('region', {
      name: 'Lucro bruto por plataforma',
    });
    await chart.getByText('R$ 995,00', { exact: true }).waitFor();
    await chart
      .getByRole('list', { name: 'Plataformas do gráfico' })
      .getByText('Atlas', { exact: true })
      .waitFor();
    expect(await chart.locator('.recharts-bar').count()).toBe(2);
    expect(
      calls
        .filter((url) => url.searchParams.get('pageSize') === '100')
        .every(
          (url) =>
            url.searchParams.has('startDate') &&
            url.searchParams.has('endDate'),
        ),
    ).toBe(true);
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page.getByRole('option', { name: 'Atlas', exact: true }).click();
    await chart.getByText(/5,00/, { exact: false }).waitFor();
    expect(await chart.getByText('Renovada', { exact: true }).count()).toBe(0);
    expect(
      calls.some(
        (url) =>
          url.searchParams.get('pageSize') === '100' &&
          url.searchParams.get('platform') === 'ATLAS',
      ),
    ).toBe(true);
    expect(calls.some((url) => url.pathname.includes('/admin/'))).toBe(false);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('shared-only report shows filtered participation without requesting owner data', async () => {
  const build = await Bun.build({
    entrypoints: [import.meta.dir + '/report-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
  const script = await build.outputs[0].text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (req) =>
      new Response(
        new URL(req.url).pathname === '/app.js'
          ? script
          : '<div id="root"></div><script src="/app.js"></script>',
        {
          headers: {
            'Content-Type':
              new URL(req.url).pathname === '/app.js'
                ? 'text/javascript'
                : 'text/html; charset=utf-8',
          },
        },
      ),
  });
  const browser = await chromium.launch({
    executablePath: '/opt/google/chrome/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    const calls = [];
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      calls.push(url);
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: { data: { id: 'partner', isAdmin: false, isClient: true } },
        });
      if (url.pathname === '/api/relatorios/plataformas')
        return route.fulfill({
          json: {
            data: [
              {
                id: 'shared',
                tag: 'SHARED',
                name: 'Compartilhada',
                isActive: true,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        });
      if (url.pathname === '/api/coproducao/recebimentos')
        return route.fulfill({
          json: {
            data: [],
            total: 0,
            page: 1,
            pageSize: 10,
            summary: {
              creditedCents: 1234,
              lockedCents: 500,
              reversedCents: 100,
            },
          },
        });
      if (url.pathname === '/api/relatorios/financeiro')
        return route.fulfill({
          json: {
            unit: 'cents',
            platformsCount: 0,
            participationOnly: true,
            summary: {},
            coproducao: {
              count: 1,
              creditedCents: 1234,
              lockedCents: 500,
              reversedCents: 100,
            },
          },
        });
      return route.fulfill({ json: { data: [] } });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page
      .getByRole('combobox', { name: 'Plataforma', exact: true })
      .click();
    await page
      .getByRole('option', { name: 'Compartilhada', exact: true })
      .click();
    await page.getByText(/Somente sua participação de coprodução/).waitFor();
    await page.getByText('R$ 12,34', { exact: true }).waitFor();
    expect(
      calls.some((url) =>
        /\/(mensal|metodos|status|transacoes)$/.test(url.pathname),
      ),
    ).toBe(false);
    expect(
      calls.some(
        (url) =>
          url.pathname === '/api/coproducao/recebimentos' &&
          url.searchParams.get('platform') === 'SHARED' &&
          url.searchParams.has('startDate') &&
          url.searchParams.has('endDate'),
      ),
    ).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
