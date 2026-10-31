import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';

const accounts = [
  { id: 'partner', name: 'Parceiro Local', email: 'partner@example.test' },
  { id: 'first', name: 'Primeira Pessoa', email: 'first@example.test' },
  { id: 'second', name: 'Segunda Pessoa', email: 'second@example.test' },
];
function accountResponse(url) {
  const term = (url.searchParams.get('search') || '').toLowerCase();
  const data = accounts.filter(
    (account) =>
      account.name.toLowerCase().includes(term) || account.email.includes(term),
  );
  return { data, total: data.length, page: 1, pageSize: 20 };
}
async function addParticipant(page, search, email, percentage) {
  await page.getByRole('button', { name: 'Adicionar coprodutor' }).click();
  expect(await page.getByRole('dialog').count()).toBe(1);
  const row = page.getByRole('listitem').last();
  await row.getByRole('combobox', { name: 'Coprodutor' }).click();
  await page.getByRole('option').first().waitFor();
  const input = page.getByRole('combobox', {
    name: 'Pesquisar contas por nome ou e-mail',
  });
  await input.click();
  expect(await input.isVisible()).toBe(true);
  await input.fill(search);
  await page.getByRole('option').filter({ hasText: email }).click();
  await row
    .getByRole('textbox', { name: 'Participação', exact: false })
    .fill(percentage);
  await row.getByRole('textbox', { name: 'Participação', exact: false }).blur();
}

test('five products load safely, edit and discard drafts, save percentages, recover failures and conflicts', async () => {
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
          : '<style>[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0008;z-index:50}[data-slot=dialog-content]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-height:90vh;overflow:auto;background:white;z-index:51}[data-slot=popover-content]{position:relative;z-index:60;background:white}</style><div id="root"></div><script src="/app.js"></script>',
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
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('Browser error:', error.message);
    });
    let agreement = { basis: 'NET', version: 1, participants: [] };
    let loadError = false,
      saveError = false,
      conflict = false,
      delay = false;
    const writes = [];
    const requests = [];
    await page.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api')) return route.continue();
      requests.push(url.pathname);
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'owner',
              email: 'owner@example.test',
              isAdmin: false,
              clientStatus: 'APPROVED',
            },
          },
        });
      if (url.pathname === '/api/coproducao/contas')
        return route.fulfill({ json: accountResponse(url) });
      if (request.method() === 'GET') {
        if (delay) await new Promise((resolve) => setTimeout(resolve, 600));
        return route.fulfill({
          status: loadError ? 503 : 200,
          json: loadError
            ? { message: 'Servidor indisponível' }
            : { data: agreement },
        });
      }
      const body = request.postDataJSON();
      writes.push({ path: url.pathname, body });
      if (saveError || conflict)
        return route.fulfill({
          status: conflict ? 409 : 500,
          json: {
            message: conflict
              ? 'Configuração alterada por outra sessão'
              : 'Falha ao salvar',
          },
        });
      agreement = { ...body, version: body.version + 1 };
      return route.fulfill({ json: { data: agreement } });
    });
    for (const kind of [
      'links-pagamento',
      'links-assinatura',
      'boletos',
      'planos',
      'planos-pix',
    ]) {
      agreement = { basis: 'NET', version: 1, participants: [] };
      await page.goto(`http://127.0.0.1:${server.port}/?kind=${kind}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page
        .getByRole('button', { name: 'Co-produção', exact: true })
        .click();
      await page.getByText('Sem coprodutores.', { exact: false }).waitFor();
      await addParticipant(page, 'Parceiro', 'partner@example.test', '25,50');
      // No API mutation until explicit main Save.
      const before = writes.length;
      await page
        .locator('[data-slot="dialog-overlay"]')
        .click({ position: { x: 2, y: 2 } });
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      expect(new URL(page.url()).searchParams.has('modal')).toBe(false);
      expect(writes.length).toBe(before);
      await page
        .getByRole('button', { name: 'Co-produção', exact: true })
        .click();
      await page.getByText('Sem coprodutores.', { exact: false }).waitFor();
      await addParticipant(
        page,
        'partner@example',
        'partner@example.test',
        '25,50',
      );
      saveError = true;
      await page
        .getByRole('button', { name: 'Salvar co-produção', exact: true })
        .click();
      await page
        .getByRole('dialog')
        .getByText('Falha ao salvar', { exact: true })
        .waitFor();
      expect(
        await page
          .getByRole('dialog')
          .getByText('partner@example.test', { exact: true })
          .count(),
      ).toBe(1);
      saveError = false;
      await page
        .getByRole('button', { name: 'Salvar co-produção', exact: true })
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      expect(writes.at(-1)).toEqual({
        path: `/api/coproducao/${kind}/owned`,
        body: {
          basis: 'NET',
          version: 1,
          participants: [
            { email: 'partner@example.test', percentageBps: 2550 },
          ],
        },
      });
      await page
        .getByRole('button', { name: 'Co-produção', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Remover participação de partner@example.test',
        })
        .click();
      conflict = true;
      await page
        .getByRole('button', { name: 'Salvar co-produção', exact: true })
        .click();
      await page
        .getByRole('button', { name: 'Recarregar configuração' })
        .waitFor();
      conflict = false;
      agreement = { ...agreement, version: 3 };
      await page
        .getByRole('button', { name: 'Recarregar configuração' })
        .click();
      await page
        .getByRole('button', {
          name: 'Remover participação de partner@example.test',
        })
        .click();
      await page
        .getByRole('button', { name: 'Salvar co-produção', exact: true })
        .click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      expect(writes.at(-1).body).toEqual({
        basis: 'NET',
        version: 3,
        participants: [],
      });
      expect(requests).toContain(`/api/coproducao/${kind}/owned`);
    }
    loadError = true;
    await page
      .getByRole('button', { name: 'Co-produção', exact: true })
      .click();
    await page.getByRole('button', { name: 'Tentar novamente' }).waitFor();
    expect(
      await page.getByRole('button', { name: 'Adicionar coprodutor' }).count(),
    ).toBe(0);
    expect(
      await page.getByText('Sem coprodutores.', { exact: false }).count(),
    ).toBe(0);
    loadError = false;
    delay = true;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByText('Sem coprodutores.', { exact: false }).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 300000);

test('partner receipts show loading, errors, cent amounts and pagination without owning a platform', async () => {
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
          : '<style>[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0008;z-index:50}[data-slot=dialog-content]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-height:90vh;overflow:auto;background:white;z-index:51}[data-slot=popover-content]{position:relative;z-index:60;background:white}</style><div id="root"></div><script src="/app.js"></script>',
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
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [],
      requests = [];
    let failed = true;
    let releaseInitialLoad;
    const initialLoad = new Promise((resolve) => {
      releaseInitialLoad = resolve;
    });
    let holdInitialLoad = true;
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('Browser error:', error.message);
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push(url.pathname);
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'partner',
              email: 'partner@local.test',
              isAdmin: false,
              clientStatus: 'APPROVED',
            },
          },
        });
      if (holdInitialLoad) await initialLoad;
      if (failed)
        return route.fulfill({ status: 503, json: { message: 'Erro local' } });
      const number = Number(url.searchParams.get('page') ?? 1);
      return route.fulfill({
        json: {
          data: [
            {
              transactionId: String(number),
              amountCents: number === 1 ? 333 : 199,
              state: number === 1 ? 'AVAILABLE' : 'REVERSED',
              createdAt: '2026-10-21T12:00:00Z',
              product: 'planos-pix',
            },
          ],
          summary: { creditedCents: 333, lockedCents: 100, reversedCents: 199 },
          page: number,
          pageSize: 10,
          total: 11,
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?view=receipts`);
    await page
      .getByRole('status', { name: 'Carregando recebimentos' })
      .waitFor({ state: 'attached' });
    holdInitialLoad = false;
    releaseInitialLoad();
    await page.getByRole('button', { name: 'Tentar novamente' }).waitFor();
    expect(
      await page.getByText('Nenhum recebimento', { exact: false }).count(),
    ).toBe(0);
    failed = false;
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByText('Plano PIX', { exact: true }).waitFor();
    expect(await page.getByText(/R\$\s*3,33/).count()).toBe(2);
    await page.getByRole('button', { name: 'Próxima' }).click();
    await page.getByText('Página 2', { exact: true }).waitFor();
    expect(
      await page.getByRole('button', { name: 'Próxima' }).isDisabled(),
    ).toBe(true);
    expect(
      requests.every(
        (path) =>
          path === '/api/auth/me' || path === '/api/coproducao/recebimentos',
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 120000);

test('all five products accept several coproducers before creation and preserve draft on failure', async () => {
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
          : '<style>[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0008;z-index:50}[data-slot=dialog-content]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:calc(100% - 32px);max-height:90vh;overflow:auto;background:white;z-index:51}[data-slot=popover-content]{position:relative;z-index:60;background:white}</style><div id="root"></div><script src="/app.js"></script>',
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
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const writes = [],
      errors = [];
    let fail = false;
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error('Browser error:', error.message);
    });
    await page.route('**/*', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/auth/me')
        return route.fulfill({
          json: {
            data: {
              id: 'owner',
              email: 'owner@example.test',
              isAdmin: false,
              clientStatus: 'APPROVED',
            },
          },
        });
      if (url.pathname === '/api/coproducao/contas')
        return route.fulfill({ json: accountResponse(url) });
      if (request.method() !== 'POST' || url.pathname.includes('/coproducao'))
        throw new Error(
          'Unexpected configuration request before product creation',
        );
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      return route.fulfill({
        status: fail ? 503 : 201,
        json: fail ? { message: 'Falha local' } : { data: { id: 'created' } },
      });
    });
    for (const kind of [
      'links-pagamento',
      'links-assinatura',
      'boletos',
      'planos',
      'planos-pix',
    ]) {
      await page.goto(
        `http://127.0.0.1:${server.port}/?kind=${kind}&view=create`,
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      );
      await page
        .getByRole('button', { name: 'Co-produção', exact: true })
        .click();
      await addParticipant(page, 'Primeira', 'first@example.test', '20');
      await addParticipant(
        page,
        'second@example',
        'second@example.test',
        '30,50',
      );
      expect(
        await page
          .getByRole('combobox', { name: 'Coprodutor' })
          .first()
          .textContent(),
      ).toContain('Primeira Pessoa');
      expect(
        await page
          .getByRole('combobox', { name: 'Coprodutor' })
          .first()
          .textContent(),
      ).toContain('first@example.test');
      expect(await page.getByText('49,5%', { exact: true }).count()).toBe(1);
      const count = writes.length;
      await page.getByRole('button', { name: 'Aplicar coprodutores' }).click();
      expect(writes.length).toBe(count);
      await page
        .getByRole('button', { name: 'Co-produção (2)', exact: true })
        .click();
      await page
        .getByRole('button', {
          name: 'Remover participação de first@example.test',
        })
        .click();
      await page
        .locator('[data-slot="dialog-overlay"]')
        .click({ position: { x: 2, y: 2 } });
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      expect(new URL(page.url()).searchParams.has('modal')).toBe(false);
      fail = true;
      await page.getByRole('button', { name: 'Salvar produto' }).click();
      await page
        .getByRole('alert')
        .filter({ hasText: 'Falha ao criar produto' })
        .waitFor();
      expect(
        await page
          .getByRole('button', { name: 'Co-produção (2)', exact: true })
          .count(),
      ).toBe(1);
      fail = false;
      await page.getByRole('button', { name: 'Salvar produto' }).click();
      await page.getByText('Produto criado', { exact: true }).waitFor();
      expect(writes.at(-1)).toEqual({
        path: kind === 'planos-pix' ? '/api/payments/pix-plan' : `/api/${kind}`,
        body: {
          nome: 'Produto teste',
          preco: 100,
          coproduction: {
            basis: 'NET',
            version: 0,
            participants: [
              { email: 'first@example.test', percentageBps: 2000 },
              { email: 'second@example.test', percentageBps: 3050 },
            ],
          },
        },
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 300000);

test('dashboard participation summary follows period changes without adding wallet revenue', async () => {
  const build = await Bun.build({
    entrypoints: [import.meta.dir + '/browser-entry.tsx'],
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
    executablePath: '/usr/bin/google-chrome-stable',
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
          json: { data: { id: 'partner', isAdmin: false } },
        });
      return route.fulfill({
        json: {
          data: [],
          total: 1,
          page: 1,
          pageSize: 10,
          summary: {
            creditedCents:
              url.searchParams.get('startDate') === '2026-10-15' ? 200 : 100,
            lockedCents: 0,
            reversedCents: 0,
          },
        },
      });
    });
    await page.goto(`http://127.0.0.1:${server.port}/?view=summary`);
    await page.getByText('R$ 1,00', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Alterar período' }).click();
    await page.getByText('R$ 2,00', { exact: true }).waitFor();
    expect(
      calls.some(
        (url) =>
          url.searchParams.get('startDate') === '2026-10-15' &&
          url.searchParams.get('endDate') === '2026-10-31',
      ),
    ).toBe(true);
    expect(
      await page.getByText(/Créditos já integram sua carteira/).count(),
    ).toBe(1);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
