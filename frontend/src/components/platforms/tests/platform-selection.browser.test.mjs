import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

test('admin manages platforms and selects product financial owners', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/platform-selection-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"/api"',
      'process.env.NEXT_PUBLIC_CHECKOUT_BASE_URL': 'undefined',
      'process.env.NODE_ENV': '"test"',
    },
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const { default: postcss } = await import('postcss');
  const { default: tailwind } = await import('@tailwindcss/postcss');
  const cssPath = import.meta.dir + '/../../../app/globals.css';
  const css = (
    await postcss([tailwind()]).process(await Bun.file(cssPath).text(), {
      from: cssPath,
    })
  ).css;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/app.js'
          ? script
          : `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root" style="padding:24px;max-width:1000px;margin:auto"></div><script src="/app.js"></script>`,
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
    const page = await browser.newPage();
    page.on('pageerror', (error) => console.error(error.message));
    const requests = [];
    let created;
    const atlas = {
      tag: 'ATLAS',
      name: 'Atlas',
      isActive: true,
      ownerUserId: 'grupo-sim',
    };
    const areaflix = {
      tag: 'AREAFLIX',
      name: 'Áreaflix',
      isActive: true,
      ownerUserId: 'grupo-sim',
    };
    const other = {
      tag: 'OTHER',
      name: 'Outra loja',
      isActive: true,
      ownerUserId: 'other',
    };
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path === '/api/auth/me')
        return route.fulfill({
          json: { data: { id: 'admin', isAdmin: true } },
        });
      if (path === '/api/platforms/owned')
        return route.fulfill({ json: { data: [] } });
      if (path === '/api/admin/users')
        return route.fulfill({
          json: {
            data: [
              {
                id: 'admin',
                name: 'Admin',
                email: 'admin@test.com',
                isAdmin: true,
              },
              {
                id: 'other',
                name: 'Maria Silva',
                email: 'maria@test.com',
                isAdmin: false,
              },
            ],
            total: 2,
            pageSize: 20,
          },
        });
      if (path === '/api/platforms' && route.request().method() === 'POST') {
        created = route.request().postDataJSON();
        return route.fulfill({
          json: { data: { ...created, id: 'new', isActive: true } },
        });
      }
      if (path === '/api/platforms')
        return route.fulfill({ json: { data: [atlas, areaflix, other] } });
      if (path === '/api/admin/relatorios/saldos-plataformas') {
        const page = Number(
          new URL(route.request().url()).searchParams.get('page'),
        );
        // Several platforms can share an owner; pagination counts platforms, not unique owners.
        return route.fulfill({
          json: {
            data:
              page === 1
                ? [
                    { owner: { id: 'grupo-sim', name: 'Grupo SIM' } },
                    { owner: { id: 'grupo-sim', name: 'Grupo SIM' } },
                  ]
                : [{ owner: { id: 'other', name: 'Maria Silva' } }],
            total: 3,
            pageSize: 2,
          },
        });
      }
      return route.fulfill({ status: 500, json: { message: 'Falha local' } });
    });
    if (!process.env.PRODUCT_OWNER_ONLY) {
      await page.goto(`http://127.0.0.1:${server.port}`);
      await page
        .getByRole('button', { name: /Selecionar ou gerenciar plataformas/ })
        .click();
      const manager = page.getByRole('dialog', {
        name: 'Gerenciar plataformas',
      });
      await manager.getByRole('button', { name: /^Outra loja/ }).waitFor();
      expect(requests).toContain('/api/platforms');
      expect(requests).not.toContain('/api/platforms/owned');
      await manager
        .getByRole('button', { name: 'Criar plataforma', exact: true })
        .click();
      await page
        .getByPlaceholder('Ex: Minha loja', { exact: true })
        .last()
        .fill('Nova loja');
      expect(
        await manager
          .getByRole('button', { name: 'Criar plataforma', exact: true })
          .isDisabled(),
      ).toBe(true);
      await manager.getByRole('combobox', { name: 'Proprietário' }).click();
      await page.getByText('Maria Silva', { exact: true }).waitFor();
      expect(await page.getByRole('option', { name: /Admin/ }).count()).toBe(0);
      await page.getByText('Maria Silva', { exact: true }).click();
      await manager
        .getByRole('button', { name: 'Criar plataforma', exact: true })
        .click();
      await page.waitForFunction(() =>
        document.body.textContent.includes('Plataforma criada'),
      );
      expect(created.ownerUserId).toBe('other');
      await page.keyboard.press('Escape');
      await page.goto(`http://127.0.0.1:${server.port}/?admin`);
      await page
        .getByRole('button', { name: /Selecionar configuração financeira/ })
        .click();
      const picker = page.getByRole('dialog', {
        name: 'Selecionar configuração financeira',
      });
      expect(
        await picker.getByRole('button', { name: 'Padrão global' }).count(),
      ).toBe(1);
      await page.waitForFunction(() =>
        document.body.textContent.includes('Usuário: Maria Silva'),
      );
      expect(
        await picker
          .getByRole('button', { name: /Outra loja.*Usuário: Maria Silva/ })
          .count(),
      ).toBe(1);
      expect(
        await picker
          .getByRole('button', { name: /Atlas.*Usuário: Grupo SIM/ })
          .count(),
      ).toBe(1);
      expect(
        await picker
          .getByRole('button', { name: /Áreaflix.*Usuário: Grupo SIM/ })
          .count(),
      ).toBe(1);
      expect(
        await picker.getByText('Nome do proprietário indisponível').count(),
      ).toBe(0);

      expect(
        await picker.getByRole('button', { name: 'Criar plataforma' }).count(),
      ).toBe(0);
      expect(
        await picker.getByRole('button', { name: /Excluir/ }).count(),
      ).toBe(0);
      await picker.getByRole('button', { name: /Outra loja/ }).click();
      await page.waitForFunction(() =>
        document.querySelector('header')?.textContent.includes('Outra loja'),
      );
      expect(requests).toContain('/api/platforms/OTHER/financial-policy');
      await page
        .getByRole('button', { name: /Selecionar configuração financeira/ })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Padrão global' })
        .click();
      await page.waitForFunction(() =>
        document.querySelector('header')?.textContent.includes('Padrão global'),
      );
    }
    await page.goto(`http://127.0.0.1:${server.port}/?product`);
    const fs = await import('node:fs/promises');
    await fs.mkdir('/tmp/simintpay-owner-screenshots', { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.getByRole('combobox', { name: 'Proprietário' }).waitFor();
      await page.screenshot({
        path: `/tmp/simintpay-owner-screenshots/${width}-empty.png`,
      });
      expect(
        await page.getByRole('button', { name: 'Salvar destino' }).isDisabled(),
      ).toBe(true);
      await page.getByRole('combobox', { name: 'Proprietário' }).click();
      await page.getByRole('option', { name: /Maria Silva/ }).waitFor();
      await page.screenshot({
        path: `/tmp/simintpay-owner-screenshots/${width}-options.png`,
      });
      expect(await page.getByRole('option', { name: /Admin/ }).count()).toBe(0);
      await page.getByRole('option', { name: /Maria Silva/ }).click();
      await page.getByRole('button', { name: 'Salvar destino' }).click();
      expect(
        JSON.parse(await page.locator('#destination').textContent()),
      ).toEqual({ plataformas: [], ownerUserId: 'other' });
      await page.screenshot({
        path: `/tmp/simintpay-owner-screenshots/${width}-selected.png`,
      });
      await page.reload();
    }
    await page
      .getByRole('button', { name: /Selecionar titular sem plataforma/ })
      .click();
    await page.getByRole('option', { name: /Outra loja.*Maria Silva/ }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('button[aria-haspopup="listbox"]')
          ?.textContent === 'Outra loja▾',
    );
    await page.getByRole('button', { name: 'Salvar destino' }).click();
    expect(
      JSON.parse(await page.locator('#destination').textContent()),
    ).toEqual({ plataformas: ['OTHER'] });
    expect(
      await page.getByText(/Nome do proprietário indisponível/).count(),
    ).toBe(0);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
