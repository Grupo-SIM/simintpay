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
