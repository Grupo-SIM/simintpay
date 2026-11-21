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

test('platform dialog: draft survives failures, 409 reload replaces it, save sends basis points', async () => {
  const { server, browser } = await serve();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(30000);
    let current = {
      version: 1,
      defaultPercentageBps: 1000,
      commissionOnRenewals: true,
      linkBaseUrl: 'https://loja.test',
      affiliates: [
        {
          email: 'ana@local.test',
          name: 'Ana',
          code: 'ANA123',
          percentageBps: 2550,
        },
      ],
    };
    const writes = [];
    let failWith = [500, 409];
    await page.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api')) return route.continue();
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: me });
      if (url.pathname === '/api/comissoes/contas')
        return route.fulfill({
          json: {
            data: [{ id: 'b', name: 'Bruno', email: 'bruno@local.test' }],
            total: 1,
            page: 1,
            pageSize: 20,
          },
        });
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        writes.push(body);
        const status = failWith.shift();
        if (status) {
          if (status === 409)
            current = { ...current, version: 5, defaultPercentageBps: 700 };
          return route.fulfill({ status, json: { message: 'falha' } });
        }
        current = {
          ...current,
          ...body,
          version: body.version + 1,
          affiliates: body.affiliates.map((row) => ({
            ...row,
            name: row.email,
            code: 'NEW' + row.email.length,
          })),
        };
        return route.fulfill({ json: { data: current } });
      }
      return route.fulfill({ json: { data: current } });
    });
    await page.goto(server.url + '?kind=plataformas');
    await page.getByRole('button', { name: 'Afiliados', exact: true }).click();
    await page.getByText('ANA123').waitFor();
    if (process.env.AFFILIATES_SCREENSHOT_CSS)
      await page.screenshot({ path: '/tmp/affiliates-platform-1280.png' });
    expect(new URL(page.url()).searchParams.get('modal')).toBe('affiliates');
    expect(
      await page.getByRole('button', { name: 'Copiar link' }).count(),
    ).toBe(1);
    await page.getByLabel('Percentual global').fill('12,5');
    await page.getByRole('button', { name: 'Salvar afiliados' }).click();
    // falha comum: rascunho preservado
    await page
      .getByRole('alert')
      .filter({ hasText: 'falha' })
      .first()
      .waitFor();
    expect(await page.getByLabel('Percentual global').inputValue()).toBe(
      '12,5',
    );
    expect(writes[0]).toMatchObject({
      version: 1,
      defaultPercentageBps: 1250,
      commissionOnRenewals: true,
      linkBaseUrl: 'https://loja.test',
      affiliates: [{ email: 'ana@local.test', percentageBps: 2550 }],
    });
    // 409: formulário bloqueia até recarregar, recarga substitui o rascunho
    await page.getByRole('button', { name: 'Salvar afiliados' }).click();
    await page
      .getByRole('button', { name: 'Recarregar configuração' })
      .waitFor();
    expect(
      await page.getByRole('button', { name: 'Salvar afiliados' }).isDisabled(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Recarregar configuração' }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[name="affiliate-default-percentage"]')
          .value === '7',
    );
    // adiciona afiliado com conta e salva
    await page.getByRole('button', { name: 'Adicionar afiliado' }).click();
    await page
      .getByRole('listitem')
      .last()
      .getByRole('combobox', { name: 'Afiliado' })
      .click();
    await page.getByRole('option').first().click();
    await page.getByRole('switch', { name: 'Comissão nas renovações' }).click();
    await page.getByRole('button', { name: 'Salvar afiliados' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(writes[2]).toMatchObject({
      version: 5,
      defaultPercentageBps: 700,
      commissionOnRenewals: false,
    });
    expect(writes[2].affiliates).toEqual([
      { email: 'ana@local.test', percentageBps: 2550 },
      { email: 'bruno@local.test', percentageBps: null },
    ]);
    await page.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('GET 404 is an error, not an empty agreement; offer shows inherited read-only and warning', async () => {
  const { server, browser } = await serve();
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(30000);
      let notFound = true;
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1') return route.abort();
        if (!url.pathname.startsWith('/api')) return route.continue();
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: me });
        if (notFound)
          return route.fulfill({
            status: 404,
            json: { message: 'Não encontrado' },
          });
        return route.fulfill({
          json: {
            data: {
              version: 3,
              defaultPercentageBps: null,
              commissionOnRenewals: null,
              affiliates: [
                {
                  email: 'ana@local.test',
                  name: 'Ana',
                  code: 'ANA123',
                  percentageBps: 3000,
                },
              ],
              inherited: {
                defaultPercentageBps: 1000,
                commissionOnRenewals: false,
                affiliates: [
                  { name: 'Ana', code: 'ANA123', percentageBps: 1500 },
                  { name: 'Caio', code: 'CAIO99', percentageBps: 500 },
                ],
              },
            },
          },
        });
      });
      await page.goto(server.url + '?kind=ofertas');
      await page
        .getByRole('button', { name: 'Afiliados', exact: true })
        .click();
      await page.getByText(/Não foi possível carregar os afiliados/).waitFor();
      expect(
        await page.getByRole('button', { name: 'Salvar afiliados' }).count(),
      ).toBe(0);
      notFound = false;
      await page.getByRole('button', { name: 'Tentar novamente' }).click();
      await page
        .getByText('Afiliados da plataforma (somente leitura)')
        .waitFor();
      await page.getByText('Caio — 5%').waitFor();
      await page
        .getByText(/o percentual da oferta vale em vez do da plataforma/)
        .waitFor();
      expect(
        await page
          .getByRole('button', {
            name: /Usar a da plataforma \(só a primeira compra\)/,
          })
          .getAttribute('aria-pressed'),
      ).toBe('true');
      expect(await page.getByLabel('Link base').count()).toBe(0);
      expect(await page.getByText('caio@').count()).toBe(0);
      await page.screenshot({
        path: `/tmp/affiliates-offer-${viewport.width}.png`,
        fullPage: true,
      });
      await page.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

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
