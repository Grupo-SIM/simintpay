/** Local-only browser test. Start app on 4317 with API base http://127.0.0.1:4318. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const app = 'http://127.0.0.1:4317';
test(
  'client charge history, creation, debit, status, filters and old route',
  { timeout: 240000 },
  async () => {
    const browser = await chromium.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: ['--no-sandbox', '--disable-background-networking'],
    });
    const context = await browser.newContext();
    const writes = [];
    const reads = [];
    let failSave = false;
    let emptyHistory = false;
    await context.addCookies([
      { name: 'access_token', value: 'test', url: app },
    ]);
    const theme = process.env.CHARGE_TEST_THEME || 'dark';
    await context.addInitScript((theme) => {
      localStorage.setItem('access_token', 'test');
      localStorage.setItem('theme', theme);
    }, theme);
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname))
        return route.abort();
      if (url.port !== '4318') return route.continue();
      const respond = (value, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(value),
        });
      if (req.method() === 'OPTIONS') return respond({});
      if (url.pathname === '/auth/me')
        return respond({
          data: {
            id: 'admin',
            name: 'Admin',
            isAdmin: true,
            isMasterAdmin: true,
          },
        });
      if (url.pathname === '/admin/usuarios')
        return respond({
          data: [
            {
              id: 'external',
              name: 'Empresa teste',
              cpf: '12345678900',
              platformEntries: [],
              balance: 500,
              lockedBalance: 0,
              vinculado: true,
              isAtivo: true,
              isDeleted: false,
              simpayUser: {
                id: 'client-1',
                name: 'Empresa teste',
                email: 'client@example.test',
              },
            },
          ],
          total: 1,
        });
      if (url.pathname === '/admin/cobrancas/clientes')
        return respond({
          data: [
            {
              id: 'client-1',
              name: 'Empresa teste',
              email: 'client@example.test',
              saldoDisponivel: 25,
            },
          ],
        });
      if (req.method() !== 'GET') {
        writes.push({ path: url.pathname, body: req.postDataJSON() });
        if (failSave) return respond({ message: 'Falha simulada' }, 500);
        if (url.pathname.endsWith('/gerar'))
          return respond({ total: 1, criadas: 1 });
        if (url.pathname.endsWith('/debitar'))
          return respond({
            total: 1,
            sucesso: 1,
            negativos: 1,
            resultados: [
              { userId: 'client-1', ok: true, amount: 50, saldoDepois: -25 },
            ],
          });
        return respond({});
      }
      if (url.pathname === '/admin/cobrancas') {
        reads.push(url.searchParams);
        return respond({
          data: emptyHistory
            ? []
            : Array.from({ length: 20 }, (_, index) => ({
                id: `charge-${index}`,
                email: 'client@example.test',
                amount: 50,
                description: `Mensalidade ${index}`,
                mode: 'PAYABLE',
                status: 'PENDING',
                dueDate: '2026-10-31T12:00:00Z',
                createdAt: '2026-10-15T12:00:00Z',
                paymentRef: 'link-1',
                saldoDepois: null,
              })),
          totalPages: 2,
        });
      }
      return respond({ data: [], total: 0 });
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(`${app}/admin/cobrancas`, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
      await page.waitForURL('**/admin/contas?tab=usuarios');
      await page
        .getByRole('button', { name: 'Cobranças', exact: true })
        .click();
      await page.getByText('Mensalidade 0', { exact: true }).waitFor();
      assert.equal(reads[0].get('search'), 'client@example.test');
      const scrolling = await page
        .getByLabel('Histórico de cobranças')
        .evaluate((el) => el.scrollHeight > el.clientHeight);
      assert.ok(scrolling);
      await page.screenshot({ path: `/tmp/simintpay-charges-${theme}.png` });
      await page
        .getByRole('button', { name: 'Próxima', exact: true })
        .first()
        .click();
      await page.waitForFunction(() =>
        document.body.innerText.includes('Página 2 de 2'),
      );
      assert.equal(reads.at(-1).get('page'), '2');
      await page
        .getByRole('button', { name: 'Marcar paga', exact: true })
        .first()
        .click();
      await page.getByText('Cobrança atualizada', { exact: true }).waitFor();
      assert.equal(writes.at(-1).body.status, 'PAID');
      await page
        .getByRole('button', { name: 'Cancelar cobrança', exact: true })
        .first()
        .click();
      await page
        .getByRole('button', {
          name: 'Confirmar cancelar cobrança',
          exact: true,
        })
        .first()
        .click();
      await page.waitForTimeout(200);
      assert.equal(writes.at(-1).body.status, 'CANCELED');
      await page
        .getByRole('button', { name: 'Data inicial', exact: true })
        .click();
      await page
        .getByRole('button', { name: '01', exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(reads.at(-1).get('dataInicio'), '2026-10-01');
      await page
        .getByRole('button', { name: 'Nova cobrança', exact: true })
        .click();
      await page
        .getByText('Saldo disponível: R$ 25,00', { exact: false })
        .waitFor();
      await page.screenshot({ path: `/tmp/simintpay-new-charge-${theme}.png` });
      await page.getByLabel('Valor (R$)').fill('5000');
      await page.getByLabel('Descrição', { exact: true }).fill('Ajuste mensal');
      await page
        .getByRole('button', { name: 'Vencimento', exact: true })
        .click();
      await page
        .getByRole('button', { name: '31', exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
      await page.waitForTimeout(400);
      failSave = true;
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await page.getByText('Falha simulada', { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel('Descrição', { exact: true }).inputValue(),
        'Ajuste mensal',
      );
      failSave = false;
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await page.getByText('Cobrança gerada', { exact: true }).waitFor();
      assert.deepEqual(writes.at(-1).body, {
        itens: [{ userId: 'client-1', amount: 50 }],
        descricao: 'Ajuste mensal',
        dueDate: '2026-10-31',
      });
      await page
        .getByRole('button', { name: 'Nova cobrança', exact: true })
        .click();
      await page
        .getByRole('button', { name: /Gerar cobrança a pagar/ })
        .click();
      await page.getByText('Debitar do saldo', { exact: true }).click();
      await page.getByLabel('Valor (R$)').fill('5000');
      await page.waitForTimeout(400);
      await page.getByText(/Conta ficará com saldo negativo/).waitFor();
      await page
        .getByRole('button', { name: 'Revisar débito', exact: true })
        .click();
      const count = writes.length;
      await page
        .getByRole('button', { name: 'Aplicar débito', exact: true })
        .click();
      assert.equal(writes.length, count);
      await page
        .getByRole('button', { name: 'Confirmar aplicar débito', exact: true })
        .click();
      await page.getByText('Débito aplicado', { exact: true }).waitFor();
      assert.deepEqual(writes.at(-1).body, {
        itens: [{ userId: 'client-1', amount: 50 }],
      });
      emptyHistory = true;
      await page
        .getByRole('button', { name: 'Próxima', exact: true })
        .first()
        .click();
      await page
        .getByText('Nenhuma cobrança encontrada.', { exact: true })
        .waitFor();
      await page.screenshot({
        path: `/tmp/simintpay-charges-empty-${theme}.png`,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
