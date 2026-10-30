import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('platform creation opens integration settings with saved, discarded and failed webhook edits', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/platform-selection-browser-entry.tsx'],
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
    executablePath: '/opt/google/chrome/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const platforms = [];
    const writes = [];
    let failLoad = false;
    let failSave = false;
    let rotations = 0;
    let failRotate = false;
    let settingsReads = 0;
    const settings = {
      INBOUND_TOKEN: 'server-generated-token',
      INBOUND_OPERATIONS: 'payments:read,payments:create',
      WEBHOOK_SECRET: 'server-generated-secret',
      WEBHOOK_URL: null,
    };
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/auth/me')
        return route.fulfill({
          json: { data: { id: 'owner', isAdmin: false } },
        });
      if (path === '/api/platforms/owned')
        return route.fulfill({ json: { data: platforms } });
      if (path === '/api/platforms' && request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(Object.keys(body).sort()).toEqual(['name', 'tag']);
        const platform = {
          ...body,
          id: 'platform-id',
          ownerUserId: 'owner',
          isActive: true,
        };
        platforms.push(platform);
        return route.fulfill({ json: { data: platform } });
      }
      if (path === '/api/platforms/platform-id/integrations/settings') {
        settingsReads++;
        if (failLoad)
          return route.fulfill({
            status: 500,
            json: { message: 'Falha local' },
          });
        await new Promise((resolve) => setTimeout(resolve, 100));
        return route.fulfill({ json: { data: settings } });
      }
      if (
        path === '/api/platforms/platform-id/integrations/credentials/rotate'
      ) {
        rotations++;
        expect(request.method()).toBe('POST');
        if (failRotate)
          return route.fulfill({
            status: 500,
            json: { message: 'Falha ao rotacionar' },
          });
        settings.INBOUND_TOKEN = 'rotated-token';
        settings.WEBHOOK_SECRET = 'rotated-secret';
        return route.fulfill({ json: { data: settings } });
      }
      if (path === '/api/platforms/platform-id/integrations/WEBHOOK_URL') {
        expect(request.method()).toBe('PUT');
        writes.push(request.postDataJSON());
        if (failSave)
          return route.fulfill({
            status: 500,
            json: { message: 'Erro ao salvar' },
          });
        settings.WEBHOOK_URL = request.postDataJSON().value;
        return route.fulfill({ json: { data: [] } });
      }
      return route.fulfill({ status: 500, json: { message: 'Falha local' } });
    });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page
      .getByRole('button', { name: /Selecionar ou gerenciar plataformas/ })
      .click();
    await page.getByRole('button', { name: 'Criar plataforma' }).click();
    await page.getByLabel('Nome', { exact: false }).fill('Minha loja');
    await page.getByLabel('Nome', { exact: false }).blur();
    await page.getByRole('button', { name: 'Criar plataforma' }).click();
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await page
      .getByLabel('Carregando configurações')
      .waitFor({ state: 'attached' });
    await page.getByText('server-generated-token', { exact: true }).waitFor();
    await page.getByText('server-generated-secret', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Copiar INBOUND_TOKEN', exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      settings.INBOUND_TOKEN,
    );
    failRotate = true;
    await page
      .getByRole('button', { name: 'Rotacionar segredos', exact: true })
      .click();
    expect(rotations).toBe(0);
    await page
      .getByRole('button', {
        name: 'Confirmar rotacionar segredos',
        exact: true,
      })
      .click();
    await page
      .getByText('Não foi possível rotacionar', { exact: true })
      .waitFor();
    await page.getByText('server-generated-token', { exact: true }).waitFor();
    failRotate = false;
    await page
      .getByRole('button', { name: 'Rotacionar segredos', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Confirmar rotacionar segredos',
        exact: true,
      })
      .click();
    await page.getByText('rotated-token', { exact: true }).waitFor();
    await page.getByText('rotated-secret', { exact: true }).waitFor();
    expect(rotations).toBe(2);
    const url = page.getByLabel('WEBHOOK_URL', { exact: true });
    await url.fill('https://minhaloja.com.br/webhook');
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    expect(writes).toHaveLength(0);
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await url.waitFor();
    expect(await url.inputValue()).toBe('');
    await url.fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('URL inválida', { exact: true }).waitFor();
    expect(writes).toHaveLength(0);
    await url.fill('https://minhaloja.com.br/webhook');
    failSave = true;
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Não foi possível salvar', { exact: true }).waitFor();
    expect(await url.inputValue()).toBe('https://minhaloja.com.br/webhook');
    failSave = false;
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await url.waitFor();
    expect(await url.inputValue()).toBe('https://minhaloja.com.br/webhook');
    await url.fill('');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .waitFor();
    expect(writes.at(-1)).toEqual({ value: null });
    failLoad = true;
    await page
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await page
      .getByText('Não foi possível carregar configurações.', { exact: true })
      .waitFor();
    expect(
      await page.getByText(settings.INBOUND_TOKEN, { exact: true }).count(),
    ).toBe(0);
    failLoad = false;
    await page
      .getByRole('button', { name: 'Tentar novamente', exact: true })
      .last()
      .click();
    await page.getByText(settings.INBOUND_TOKEN, { exact: true }).waitFor();
    expect(settingsReads).toBeGreaterThanOrEqual(5);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);
