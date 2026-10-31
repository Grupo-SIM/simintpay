/** Run against a local build with NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4318.
 * CLIENT_TEST_BASE_URL=http://127.0.0.1:4317 node --test <this-file>
 * Browser requests are mocked; non-local requests are blocked before leaving machine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const appUrl = process.env.CLIENT_TEST_BASE_URL ?? 'http://127.0.0.1:4317';
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(appUrl).hostname),
  'Tests require local app',
);
const fixtures = [
  {
    kind: 'planos',
    endpoint: '/planos',
    method: 'POST',
    label: 'Nome do plano',
    field: 'nome',
    detail: { nome: 'Mensal', preco: 29.99, tipo: 'TRIMESTRAL', frequencia: 2 },
  },
  {
    kind: 'planos-pix',
    endpoint: '/payments/pix-plan',
    method: 'PATCH',
    label: 'Nome do plano',
    field: 'description',
    detail: {
      description: 'Mensal [TENANT:CLIENT:test]',
      price: 29.99,
      frequency_type: 'TRIMESTRAL',
      status: 'ACTIVE',
      linkCode: 'stable-code',
    },
  },
  {
    kind: 'links-pagamento',
    endpoint: '/links-pagamento',
    method: 'PUT',
    label: 'Título do link',
    field: 'titulo',
    detail: {
      titulo: 'Mensal',
      descricao: 'Descrição',
      valor: 29.99,
      parcelasMax: 6,
      aceitaCartao: false,
      aceitaDebito: true,
      aceitaPix: true,
    },
  },
  {
    kind: 'links-assinatura',
    endpoint: '/links-assinatura',
    method: 'PUT',
    label: 'Nome do link',
    field: 'nome',
    detail: {
      nome: 'Mensal',
      descricao: 'Descrição',
      valor: 29.99,
      frequencia: 'TRIMESTRAL',
      paymentMethods: 'PIX',
      codigo: 'stable-code',
    },
  },
  {
    kind: 'boletos',
    endpoint: '/boletos',
    method: 'PUT',
    label: 'Título do boleto',
    field: 'titulo',
    detail: {
      titulo: 'Mensal',
      descricao: 'Descrição',
      valor: 29.99,
      vencimentoDias: 7,
    },
  },
];
const browserOptions = {
  executablePath:
    process.env.CLIENT_TEST_CHROME ?? '/usr/bin/google-chrome-stable',
  headless: true,
  args: ['--no-sandbox', '--disable-background-networking'],
};

async function scenario(
  browser,
  { status = 'APPROVED', admin = false, theme = 'light', width = 1280 } = {},
) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const state = {
    failLoad: false,
    failSave: false,
    delay: false,
    calls: [],
    writes: [],
    active: true,
  };
  await context.addCookies([
    { name: 'access_token', value: 'local-test', url: appUrl },
  ]);
  await context.addInitScript(
    ({ theme }) => {
      localStorage.setItem('access_token', 'local-test');
      localStorage.setItem('theme', theme);
    },
    { theme },
  );
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      return route.abort();
    if (url.port !== '4318') return route.continue();
    state.calls.push(url.pathname);
    const fulfill = (data, code = 200) =>
      route.fulfill({
        status: code,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    if (url.pathname === '/auth/me')
      return fulfill({
        data: {
          id: 'client',
          name: 'Cliente teste',
          email: 'client@example.test',
          isAdmin: admin,
          isClient: !admin,
          clientStatus: admin ? null : status,
          tenantModule: null,
        },
      });
    const fixture = fixtures.find(
      (item) =>
        url.pathname.startsWith(item.endpoint) ||
        (item.kind === 'planos-pix' &&
          url.pathname === '/bot/pix-plan/owned/status'),
    );
    if (!fixture) return fulfill({ data: [], total: 0 });
    if (request.method() !== 'GET') {
      if (url.pathname.endsWith('/desativar')) state.active = false;
      else if (url.pathname === '/bot/pix-plan/owned/status')
        state.active = !state.active;
      else if (request.postDataJSON()?.isActive != null)
        state.active = request.postDataJSON().isActive;
      state.writes.push({
        path: url.pathname,
        method: request.method(),
        body: request.postDataJSON(),
      });
      return state.failSave
        ? fulfill({ message: 'Falha simulada ao salvar' }, 500)
        : fulfill({ data: { id: 'owned', ...request.postDataJSON() } });
    }
    if (url.pathname !== fixture.endpoint) {
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      if (state.failLoad)
        return fulfill({ message: 'Registro indisponível' }, 404);
      return fulfill({
        data: {
          id: 'owned',
          codigo: 'stable-code',
          webhookUrl: 'https://preserved.example.test/hook',
          redirectUrl: 'https://preserved.example.test/return',
          platformFee: 9,
          ...fixture.detail,
        },
      });
    }
    const row = {
      id: 'owned',
      ativo: state.active,
      plataformas: ['SIMINTPAY'],
      criadoEm: '2026-10-14T12:00:00-03:00',
      ...fixture.detail,
    };
    return fulfill(
      fixture.kind === 'planos-pix'
        ? { items: [row], meta: { totalItems: 1, totalPages: 1 } }
        : { data: [row], total: 1 },
    );
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, state, errors };
}

test(
  'five client products hydrate, save safely, discard, validate and recover errors',
  { timeout: 300000 },
  async () => {
    const browser = await chromium.launch(browserOptions);
    try {
      for (const fixture of fixtures) {
        const { context, page, state, errors } = await scenario(browser);
        try {
          const editUrl = `${appUrl}/cliente/${fixture.kind}/criar?id=owned`;
          state.delay = true;
          await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
          await page.getByLabel('Carregando produto').waitFor();
          await page
            .getByRole('button', { name: 'Salvar', exact: true })
            .waitFor();
          state.delay = false;
          const name = page.getByLabel(fixture.label, { exact: false });
          assert.equal(await name.inputValue(), 'Mensal', fixture.kind);
          const amount = page.getByLabel('Valor', { exact: false }).first();
          assert.equal(await amount.inputValue(), '29,99', fixture.kind);
          await amount.fill('1498');
          await page
            .getByRole('button', { name: 'Salvar', exact: true })
            .click();
          await page
            .getByText('O valor mínimo é R$ 14,99', { exact: true })
            .first()
            .waitFor();
          assert.equal(state.writes.length, 0);
          await amount.fill('2999');
          await name.fill('Alterado agora');
          state.failSave = true;
          await page
            .getByRole('button', { name: 'Salvar', exact: true })
            .click();
          await page
            .getByText('Falha simulada ao salvar', { exact: true })
            .waitFor();
          assert.equal(await name.inputValue(), 'Alterado agora');
          state.failSave = false;
          await page
            .getByRole('button', { name: 'Salvar', exact: true })
            .click();
          await page.waitForURL(`${appUrl}/cliente/${fixture.kind}`);
          const update = state.writes.at(-1);
          assert.equal(update.method, fixture.method);
          assert.equal(update.path, `${fixture.endpoint}/owned`);
          assert.ok(update.body[fixture.field].startsWith('Alterado agora'));
          for (const key of [
            'id',
            'codigo',
            'code',
            'userId',
            'platformFee',
            'plataformas',
            'webhookUrl',
            'redirectUrl',
          ])
            assert.ok(
              !(key in update.body),
              `${fixture.kind} must preserve ${key}`,
            );
          if (fixture.kind === 'planos-pix')
            assert.ok(update.body.description.includes('[TENANT:CLIENT:test]'));
          if (fixture.kind === 'links-pagamento')
            assert.equal(update.body.aceitaCartao, false);
          const publicLink = await page
            .getByRole('link', { name: 'Abrir', exact: true })
            .getAttribute('href');
          assert.ok(
            publicLink.includes(
              fixture.kind === 'planos-pix' ||
                fixture.kind === 'links-assinatura'
                ? 'stable-code'
                : 'owned',
            ),
          );
          for (const column of [
            'Link',
            'Plataformas',
            'Preço',
            'Status',
            'Ações',
          ])
            await page
              .getByRole('columnheader', { name: column, exact: true })
              .waitFor();
          await page
            .getByText('Sim Int Pay', { exact: true })
            .first()
            .waitFor();
          await page
            .getByRole('button', { name: 'Inativar', exact: true })
            .click();
          await page.getByText('Registro inativado', { exact: true }).waitFor();
          const statusWrite = state.writes.at(-1);
          assert.equal(statusWrite.method, fixture.method);
          assert.deepEqual(
            statusWrite.body,
            fixture.kind === 'planos'
              ? {}
              : fixture.kind === 'planos-pix'
                ? null
                : { isActive: false },
          );
          assert.equal(
            statusWrite.path,
            fixture.kind === 'planos-pix'
              ? '/bot/pix-plan/owned/status'
              : `${fixture.endpoint}/owned${fixture.kind === 'planos' ? '/desativar' : ''}`,
          );
          await page
            .getByRole('button', { name: 'Ativar', exact: true })
            .waitFor();
          await page
            .getByRole('button', { name: 'Ativar', exact: true })
            .click();
          await page.getByText('Registro ativado', { exact: true }).waitFor();
          const activeWrite = state.writes.at(-1);
          assert.deepEqual(
            activeWrite.body,
            fixture.kind === 'planos-pix' ? null : { isActive: true },
          );
          await page
            .getByRole('button', { name: 'Inativar', exact: true })
            .waitFor();
          const count = state.writes.length;
          await page.goto(editUrl);
          await name.fill('Descartado');
          await page
            .getByRole('button', { name: 'Descartar', exact: true })
            .click();
          await page.waitForURL(`${appUrl}/cliente/${fixture.kind}`);
          assert.equal(state.writes.length, count);
          state.failLoad = true;
          await page.goto(editUrl);
          await page
            .getByRole('button', { name: 'Tentar novamente', exact: true })
            .waitFor();
          assert.equal(
            await page
              .getByRole('button', { name: 'Salvar', exact: true })
              .count(),
            0,
          );
          state.failLoad = false;
          await page
            .getByRole('button', { name: 'Tentar novamente', exact: true })
            .click();
          await name.waitFor();
          assert.equal(await name.inputValue(), 'Mensal');
          assert.deepEqual(errors, [], fixture.kind);
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  'client direct URLs never mount restricted queries; account approval gates forms',
  { timeout: 180000 },
  async () => {
    const browser = await chromium.launch(browserOptions);
    try {
      const { context, page, state } = await scenario(browser);
      for (const path of [
        '/admin/usuarios',
        '/comunidades',
        '/planos',
        '/assinantes',
      ]) {
        state.calls.length = 0;
        await page.goto(`${appUrl}${path}`);
        await page
          .getByRole('heading', { name: 'Acesso restrito', exact: true })
          .waitFor();
        assert.ok(
          state.calls.every((call) =>
            ['/auth/me', '/admin/cobrancas/minhas'].includes(call),
          ),
          `${path}: ${state.calls.join(', ')}`,
        );
      }
      await context.close();
      for (const status of ['PENDING', 'REJECTED']) {
        const blocked = await scenario(browser, { status });
        await blocked.page.goto(`${appUrl}/cliente/boletos/criar?id=owned`);
        await blocked.page
          .getByRole('heading', {
            name:
              status === 'PENDING'
                ? 'Sua conta está em análise.'
                : 'Sua conta não foi aprovada.',
          })
          .waitFor();
        assert.ok(
          !blocked.state.calls.some((path) => path.startsWith('/boletos')),
        );
        assert.equal(
          await blocked.page
            .getByRole('button', { name: 'Salvar', exact: true })
            .count(),
          0,
        );
        await blocked.context.close();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  'five listings/forms fit desktop/mobile and both themes; admin page still mounts',
  { timeout: 240000 },
  async () => {
    const browser = await chromium.launch(browserOptions);
    try {
      for (const width of [390, 1280])
        for (const theme of ['light', 'dark']) {
          const { context, page, errors } = await scenario(browser, {
            width,
            theme,
          });
          for (const fixture of fixtures) {
            for (const suffix of ['', '/criar?id=owned']) {
              await page.goto(`${appUrl}/cliente/${fixture.kind}${suffix}`);
              await page
                .getByRole('button', {
                  name: suffix ? 'Salvar' : 'Editar',
                  exact: true,
                })
                .waitFor();
              assert.ok(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
                `${fixture.kind}/${theme}/${width} body overflow`,
              );
              assert.equal(
                await page.evaluate(() =>
                  document.documentElement.classList.contains('dark'),
                ),
                theme === 'dark',
              );
              if (process.env.CLIENT_TEST_SCREENSHOTS) {
                await mkdir(process.env.CLIENT_TEST_SCREENSHOTS, {
                  recursive: true,
                });
                await page.screenshot({
                  path: join(
                    process.env.CLIENT_TEST_SCREENSHOTS,
                    `${fixture.kind}-${suffix ? 'edit' : 'list'}-${theme}-${width}.png`,
                  ),
                  fullPage: true,
                });
              }
            }
          }
          assert.deepEqual(errors, []);
          await context.close();
        }
      const admin = await scenario(browser, { admin: true });
      await admin.page.goto(`${appUrl}/planos`);
      await admin.page
        .getByRole('heading', { name: 'Planos', exact: true })
        .waitFor();
      assert.ok(admin.state.calls.includes('/planos'));
      assert.ok(
        !(await admin.page
          .getByRole('heading', { name: 'Acesso restrito', exact: true })
          .count()),
      );
      await admin.context.close();
    } finally {
      await browser.close();
    }
  },
);

test(
  'five client listing actions stay visible on desktop',
  { timeout: 360000 },
  async () => {
    const browser = await chromium.launch(browserOptions);
    try {
      for (const theme of ['light', 'dark']) {
        const { context, page, state, errors } = await scenario(browser, {
          theme,
          width: 1280,
        });
        try {
          for (const fixture of fixtures) {
            await page.goto(`${appUrl}/cliente/${fixture.kind}`);
            const edit = page.getByRole('button', {
              name: 'Editar',
              exact: true,
            });
            try {
              await edit.waitFor({ timeout: 60000 });
            } catch (error) {
              console.error({
                kind: fixture.kind,
                theme,
                calls: state.calls,
                errors,
                content: (await page.locator('body').innerText()).slice(
                  0,
                  2000,
                ),
              });
              throw error;
            }
            for (const control of [
              edit,
              page.getByRole('button', { name: 'Inativar', exact: true }),
              page.getByRole('button', { name: 'Excluir', exact: true }),
            ]) {
              const rect = await control.boundingBox();
              assert.ok(
                rect && rect.x >= 0 && rect.x + rect.width <= 1280,
                `${fixture.kind}/${theme}: row action outside viewport`,
              );
            }
            if (process.env.CLIENT_TEST_SCREENSHOTS) {
              await mkdir(process.env.CLIENT_TEST_SCREENSHOTS, {
                recursive: true,
              });
              await page.screenshot({
                path: join(
                  process.env.CLIENT_TEST_SCREENSHOTS,
                  `${fixture.kind}-list-${theme}-1280.png`,
                ),
                fullPage: true,
              });
            }
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  },
);
