import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Real page components, local navigation adapter, mocked APIs. External requests are blocked.
test('panel controls, platform search, accounts and subscriber filters', async () => {
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/panel-browser-entry.tsx'],
    target: 'browser',
    define: {
      'process.env': '{}',
      'process.env.NEXT_PUBLIC_API_BASE_URL': '"http://127.0.0.1:4329/api"',
      'process.env.NODE_ENV': '"test"',
    },
    plugins: [
      {
        name: 'local-navigation',
        setup(build) {
          build.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: import.meta.dir + '/navigation-fixture.ts',
          }));
          build.onResolve({ filter: /^next\/link$/ }, () => ({
            path: 'local-link',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            loader: 'js',
            contents:
              'import { createElement } from "react"; export default function Link({children, ...props}) { return createElement("a", props, children); }',
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw new Error(bundle.logs.join('\n'));
  const script = await bundle.outputs[0].text();
  const stylesheet = import.meta.dir + '/../../globals.css';
  const styles = (
    await postcss([tailwind()]).process(await Bun.file(stylesheet).text(), {
      from: stylesheet,
    })
  ).css;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      return new Response(
        path === '/app.js'
          ? script
          : path === '/style.css'
            ? styles
            : '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
        {
          headers: {
            'Content-Type':
              path === '/app.js'
                ? 'text/javascript'
                : path === '/style.css'
                  ? 'text/css'
                  : 'text/html; charset=utf-8',
          },
        },
      );
    },
  });
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking'],
  });
  const errors = [];
  let client = false,
    failCreate = true;
  const reads = [],
    writes = [];
  const context = await browser.newContext();
  const platforms = Array.from({ length: 30 }, (_, index) => ({
    tag: `LOJA-${index}`,
    name: `Loja ${index}`,
    isActive: true,
    ownerUserId: 'owner',
    owner: { id: 'owner', name: 'Maria' },
  }));
  const subscriber = (id, status, extra = {}) => ({
    id,
    nome: id,
    status,
    frequencia: 'MONTHLY',
    intervalo: 1,
    plataforma: 'LOJA-29',
    ...extra,
  });
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api/'))
      return url.port === '4329'
        ? route.fulfill({ contentType: 'text/event-stream', body: '\n' })
        : route.continue();
    const path = url.pathname.slice(4);
    reads.push({ path, query: Object.fromEntries(url.searchParams) });
    const respond = (json, status = 200) => route.fulfill({ status, json });
    if (path === '/auth/me')
      return respond({
        data: {
          id: 'admin',
          name: 'Admin',
          email: 'master@test.local',
          isAdmin: !client,
          isMasterAdmin: !client,
          isClient: client,
          clientStatus: 'APPROVED',
          tenantModule: null,
        },
      });
    if (path === '/platforms') return respond({ data: platforms });
    if (path === '/admin/relatorios/saldos-plataformas')
      return respond({
        data: [{ owner: { id: 'owner', name: 'Maria' } }],
        total: 1,
        pageSize: 12,
      });
    if (path === '/admin/usuarios')
      return respond({
        data: [
          {
            id: 'account',
            name: 'Empresa',
            cpf: '12345678000199',
            platformEntries: [
              { id: 'entry', platform: 'BOSQUE', email: 'empresa@test.local' },
            ],
            balance: 0,
            lockedBalance: 0,
            isAtivo: true,
          },
        ],
        total: 1,
      });
    if (request.method() !== 'GET') {
      writes.push({
        path,
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : null,
      });
      if (path === '/admin/criar-conta')
        return failCreate
          ? respond({ message: 'Falha simulada' }, 400)
          : respond({ data: { userId: 'new', email: 'nova@test.local' } });
      return respond({ data: {}, created: 0, linked: 0, walletsUpdated: 0 });
    }
    if (path === '/assinantes') {
      const q = url.searchParams;
      const rows =
        q.get('statusGroup') === 'deactivated'
          ? [subscriber('Desativada', 'CANCELLED')]
          : [
              subscriber('Ativa', 'ACTIVE'),
              subscriber('Desativada', 'CANCELLED'),
              subscriber('Desconhecida', 'NEW'),
              subscriber('Pausada', 'CANCELLED', { isPaused: true }),
            ];
      return respond({
        data: rows,
        total: rows.length,
        page: Number(q.get('page') ?? 1),
        pageSize: 20,
        hasNextPage: false,
      });
    }
    if (path === '/transacoes')
      return respond({
        data: {
          transactions: [
            {
              id: 'tx',
              amount: '100',
              netAmount: '90',
              totalFee: '10',
              status: 'COMPLETED',
              paymentMethod: 'PIX',
              acquirer: 'DOM',
              description: 'Plano mensal [TENANT:BOSQUE]',
              createdAt: '2026-10-20',
            },
          ],
          total: 1,
        },
        page: 1,
        limit: 20,
      });
    if (path === '/relatorios/financeiro')
      return respond({
        unit: 'cents',
        platformsCount: 1,
        summary: { grossCents: 0, salesCount: 0 },
      });
    if (path.includes('consolidado'))
      return respond({
        lucroTotalMaster: 1,
        totalTaxasDom: 2,
        totalTaxasSimInt: 3,
      });
    if (path === '/saques/verificar-pendente')
      return respond({ hasPending: false });
    if (path === '/wallet/me')
      return respond({
        data: { balance: 10, availableBalance: 10, lockedBalance: 0 },
      });
    return respond({ data: [], total: 0, pageSize: 20, totalPages: 1 });
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    const go = (path) => page.goto(`http://127.0.0.1:${server.port}${path}`);
    await go('/search');
    await page
      .getByRole('button', { name: 'Plataforma', exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('button')?.disabled,
    );
    await page.getByRole('button', { name: 'Plataforma', exact: true }).click();
    await page
      .getByPlaceholder('Buscar plataforma ou proprietário...')
      .fill('Loja 29');
    await page.getByRole('option', { name: /Loja 29/ }).waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll('[role="option"]').length === 1,
    );
    await page
      .getByPlaceholder('Buscar plataforma ou proprietário...')
      .press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.locator('output').textContent()).toBe('LOJA-29');

    await go('/admin/contas?tab=usuarios');
    await page
      .getByRole('button', { name: 'Plataformas (1)', exact: true })
      .click();
    expect(await page.getByRole('dialog').textContent()).toContain(
      'empresa@test.local',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect(
      await page
        .getByRole('columnheader', { name: 'CPF/CNPJ', exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page.getByText('12.345.678/0001-99', { exact: true }).count(),
    ).toBe(1);
    expect(await page.getByText('Itens criados', { exact: true }).count()).toBe(
      0,
    );
    await page.getByRole('button', { name: 'Plataforma', exact: true }).click();
    await page
      .getByPlaceholder('Buscar plataforma ou proprietário...')
      .fill('Loja 29');
    await page.getByRole('option', { name: /Loja 29/ }).click();
    await page.waitForFunction(() =>
      document.body.textContent.includes('Loja 29'),
    );
    expect(
      reads.some(
        (read) =>
          read.path === '/admin/usuarios' && read.query.platform === 'loja-29',
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Criar conta', exact: true })
      .click();
    await page.locator('input[name="email"]').fill('nova@test.local');
    await page.locator('input[name="password"]').fill('SenhaSegura123!');
    await page.locator('input[name="document"]').fill('12345678900');
    await page.getByRole('button', { name: 'Criar conta agora' }).click();
    await page.getByText('Falha simulada', { exact: true }).waitFor();
    expect(await page.locator('input[name="email"]').inputValue()).toBe(
      'nova@test.local',
    );
    failCreate = false;
    await page.getByRole('button', { name: 'Criar conta agora' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    expect(
      writes.some(
        (write) =>
          write.path === '/admin/criar-conta' &&
          write.body.cpf === '12345678900',
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Criar conta', exact: true })
      .click();
    expect(await page.locator('input[name="email"]').inputValue()).toBe('');
    await page.locator('input[name="email"]').fill('descartar@test.local');
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: 'Criar conta', exact: true })
      .click();
    expect(await page.locator('input[name="email"]').inputValue()).toBe('');
    await go('/admin/contas?tab=criar-conta');
    await page.getByRole('dialog').waitFor();
    expect(page.url()).toContain('tab=usuarios');

    await go('/assinantes');
    await page.getByText('Desativada', { exact: true }).waitFor();
    expect(
      await page
        .getByRole('button', { name: 'Excluir do histórico', exact: true })
        .count(),
    ).toBe(1);
    await page.locator('thead input[type="checkbox"]').check();
    expect(
      await page
        .getByRole('button', { name: 'Excluir do histórico (1)', exact: true })
        .isEnabled(),
    ).toBe(true);
    expect(
      await page
        .getByRole('button', { name: 'Pausar (1)', exact: true })
        .isEnabled(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Limpar', exact: true }).click();
    await page.getByRole('button', { name: 'Status', exact: true }).click();
    await page
      .getByRole('option', { name: 'Desativadas', exact: true })
      .click();
    await page.waitForFunction(() =>
      location.search.includes('statusGroup=deactivated'),
    );
    await page.getByRole('button', { name: 'Intervalo', exact: true }).click();
    await page.getByRole('option', { name: 'Anual', exact: true }).click();
    await page.waitForFunction(() =>
      location.search.includes('frequency=YEARLY'),
    );
    expect(
      reads.some(
        (read) =>
          read.path === '/assinantes' &&
          read.query.statusGroup === 'deactivated' &&
          read.query.frequency === 'YEARLY',
      ),
    ).toBe(true);
    const beforeDelete = writes.length;
    await page
      .getByRole('button', { name: 'Excluir do histórico', exact: true })
      .click();
    expect(writes.length).toBe(beforeDelete);
    await page
      .getByRole('button', {
        name: 'Confirmar excluir do histórico',
        exact: true,
      })
      .click();
    await page.waitForFunction(() =>
      document.body.textContent.includes('Removida do histórico'),
    );
    expect(
      writes.some(
        (write) =>
          write.method === 'DELETE' &&
          write.path.includes('Desativada/history'),
      ),
    ).toBe(true);

    await go('/transacoes');
    await page.getByText('Plano mensal', { exact: false }).waitFor();
    expect(await page.locator('tbody').textContent()).not.toContain('TENANT:');
    expect((await page.locator('tbody').textContent()).toUpperCase()).toContain(
      'BOSQUE',
    );
    client = true;
    await go('/transacoes?acquirer=DOM');
    await page.getByText('Plano mensal', { exact: false }).waitFor();
    expect(
      await page
        .getByRole('columnheader', { name: 'Adquirente', exact: true })
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByRole('button', { name: 'Adquirente:', exact: true })
        .count(),
    ).toBe(0);
    expect(
      reads.filter((read) => read.path === '/transacoes').at(-1).query.acquirer,
    ).toBeUndefined();
    await go('/saques');
    await page.getByText(/Atenção: As solicitações de saque/).waitFor();
    expect(
      await page.evaluate(() => {
        const notice = [...document.querySelectorAll('p')].find((node) =>
          node.textContent.includes('Atenção: As solicitações'),
        );
        const balance = [...document.querySelectorAll('p')].find(
          (node) => node.textContent === 'Saldo disponível',
        );
        return Boolean(
          notice.compareDocumentPosition(balance) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    await go('/sidebar');
    expect(await page.getByRole('link', { name: /Suporte/ }).count()).toBe(0);
    client = false;
    await go('/report');
    await page
      .getByRole('heading', { name: 'Taxas Sim Int Pay', exact: true })
      .waitFor();
    expect(
      await page.evaluate(() => {
        const sim = [...document.querySelectorAll('h2')].find(
          (node) => node.textContent === 'Taxas Sim Int Pay',
        );
        const dom = [...document.querySelectorAll('h2')].find(
          (node) => node.textContent === 'Taxas DOM',
        );
        return Boolean(
          sim.compareDocumentPosition(dom) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
    ).toBe(true);
    for (const [theme, width] of [
      ['light', 1280],
      ['dark', 390],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => localStorage.setItem('theme', theme),
        theme,
      );
      await go('/admin/contas?tab=criar-conta');
      await page.getByRole('dialog').waitFor();
      const bounds = await page.getByRole('dialog').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `/tmp/simintpay-account-${theme}.png` });
    }
    await go('/preview');
    expect(
      await page.getByRole('button', { name: 'Ajustar', exact: true }).count(),
    ).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
