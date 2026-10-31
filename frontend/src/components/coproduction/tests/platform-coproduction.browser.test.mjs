import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
test('platform editor and product inheritance keep explicit empty overrides and modal history', async () => {
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
  const screenshotCss = process.env.COPRODUCTION_SCREENSHOT_CSS
    ? await Bun.file(process.env.COPRODUCTION_SCREENSHOT_CSS).text()
    : '';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/app.js'
          ? script
          : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${screenshotCss}</style><div id="root"></div><script src="/app.js"></script>`,
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
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const writes = [];
    let saved;
    let releaseSave;
    const pendingSave = new Promise((resolve) => {
      releaseSave = resolve;
    });
    await page.route('**/*', async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api')) return route.continue();
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'owner',
              email: 'owner@local.test',
              isAdmin: false,
              clientStatus: 'APPROVED',
            },
          },
        });
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        writes.push(body);
        await pendingSave;
        saved = { ...body, version: body.version + 1 };
      }
      return route.fulfill({
        json: {
          data: saved ?? {
            basis: 'NET',
            mode: 'INHERIT',
            version: 0,
            participants: [],
            effective: {
              source: { platformId: 'platform', version: 1 },
              participants: [
                {
                  email: 'partner@local.test',
                  name: 'Parceiro',
                  percentageBps: 500,
                },
              ],
            },
          },
        },
      });
    });
    await page.goto(`${server.url}?kind=planos`);
    await page
      .getByRole('button', { name: 'Co-produção', exact: true })
      .click();
    await page.getByText('Parceiro — 5%', { exact: true }).waitFor();
    expect(new URL(page.url()).searchParams.get('modal')).toBe('coproduction');
    await page
      .getByRole('button', { name: 'Configuração própria', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Salvar co-produção', exact: true })
      .click();
    await page.getByRole('button', { name: 'Salvando...' }).waitFor();
    await page
      .locator('[data-slot="dialog-overlay"]')
      .dispatchEvent('pointerdown', {
        button: 0,
        pointerType: 'mouse',
        isPrimary: true,
      });
    await page.keyboard.press('Escape');
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    releaseSave();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(writes[0]).toMatchObject({ mode: 'OWN', participants: [] });
    expect(new URL(page.url()).searchParams.has('modal')).toBe(false);
    await page
      .getByRole('button', { name: 'Co-produção', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Usar padrão da plataforma' })
      .click();
    await page
      .getByRole('button', { name: 'Salvar co-produção', exact: true })
      .click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(writes[1]).toMatchObject({ mode: 'INHERIT', participants: [] });
    saved = { basis: 'NET', mode: 'OWN', version: 0, participants: [] };
    await page.goto(`${server.url}?kind=plataformas`);
    await page
      .getByRole('button', { name: 'Co-produção', exact: true })
      .click();
    await page.getByText(/No Delivery, divisão sobre itens/).waitFor();
    expect(
      await page
        .getByRole('button', { name: 'Usar padrão da plataforma' })
        .count(),
    ).toBe(0);
    await page
      .locator('[data-slot="dialog-overlay"]')
      .dispatchEvent('pointerdown', {
        button: 0,
        pointerType: 'mouse',
        isPrimary: true,
      });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(new URL(page.url()).searchParams.has('modal')).toBe(false);
    await page
      .getByRole('button', { name: 'Co-produção', exact: true })
      .click();
    await page.goBack();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('shared platforms stay browsable without financial or integration mutation controls', async () => {
  const bundle = await Bun.build({
    entrypoints: [
      import.meta.dir +
        '/../../platforms/tests/platform-selection-browser-entry.tsx',
    ],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const screenshotCss = process.env.COPRODUCTION_SCREENSHOT_CSS
    ? await Bun.file(process.env.COPRODUCTION_SCREENSHOT_CSS).text()
    : '';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/app.js'
          ? script
          : `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${screenshotCss}</style><div id="root"></div><script src="/app.js"></script>`,
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
    args: ['--no-sandbox', '--disable-background-networking'],
  });
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      const forbidden = [];
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/api/auth/me')
          return route.fulfill({
            json: { data: { id: 'viewer', isAdmin: false } },
          });
        if (path === '/api/platforms/owned')
          return route.fulfill({
            json: {
              data: [
                {
                  id: 'shared',
                  tag: 'SHARED',
                  name: 'Loja compartilhada',
                  isActive: true,
                  coproducao: {
                    role: 'COPRODUCER',
                    readOnly: true,
                    myPercentageBps: 2500,
                  },
                },
              ],
            },
          });
        forbidden.push(path);
        return route.fulfill({ status: 403, json: { message: 'Forbidden' } });
      });
      await page.goto(`http://127.0.0.1:${server.port}`);
      await page
        .getByRole('region', { name: 'Plataforma compartilhada' })
        .waitFor();
      expect(
        await page
          .getByRole('button', { name: 'Configurações', exact: true })
          .count(),
      ).toBe(0);
      expect(
        await page
          .getByRole('button', { name: 'Co-produção', exact: true })
          .count(),
      ).toBe(0);
      await page
        .getByRole('button', { name: /Selecionar ou gerenciar plataformas/ })
        .click();
      await page
        .getByText('Coprodução · Somente leitura', { exact: true })
        .waitFor();
      expect(
        await page.getByRole('button', { name: /Remover plataforma/ }).count(),
      ).toBe(0);
      await page
        .getByRole('button', { name: /Loja compartilhada.*Coprodução/ })
        .click();
      expect(forbidden).toEqual([]);
      await page.screenshot({
        path: `/tmp/coproduction-platform-${viewport.width}.png`,
        fullPage: true,
      });
      await page.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
