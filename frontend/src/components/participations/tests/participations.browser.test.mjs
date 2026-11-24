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
  const css = process.env.PARTICIPATIONS_SCREENSHOT_CSS
    ? await Bun.file(process.env.PARTICIPATIONS_SCREENSHOT_CSS).text()
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
const accounts = [
  { id: 'a', name: 'Ana', email: 'ana@local.test' },
  { id: 'b', name: 'Bruno', email: 'bruno@local.test' },
];

/** Backend falso: cada módulo tem a sua rota e a sua versão. */
async function mock(page, state) {
  state.writes = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (!url.pathname.startsWith('/api')) return route.continue();
    if (url.pathname === '/api/auth/me')
      return route.fulfill({
        json: { data: { ...me.data, isAdmin: Boolean(state.isAdmin) } },
      });
    if (url.pathname.endsWith('/contas'))
      return route.fulfill({
        json: { data: accounts, total: 2, page: 1, pageSize: 20 },
      });
    const key = url.pathname.startsWith('/api/coproducao/')
      ? 'co'
      : url.pathname.startsWith('/api/comissoes/margem/')
        ? 'margin'
        : 'aff';
    (state.requests ??= []).push(`${req.method()} ${url.pathname}`);
    if (state.loadError?.[key])
      return route.fulfill({
        status: state.loadError[key],
        json: { message: 'Não encontrado' },
      });
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      state.writes.push({ key, body });
      const fail = state.failNext?.shift();
      if (fail) {
        if (fail.reload) state[key] = { ...state[key], ...fail.reload };
        return route.fulfill({
          status: fail.status,
          json: { message: fail.message },
        });
      }
      state[key] =
        key === 'co'
          ? { ...state.co, ...body, version: body.version + 1 }
          : key === 'margin'
            ? {
                ...state.margin,
                ...body,
                version: body.version + 1,
                affiliates: body.affiliates.map((row) => ({
                  ...row,
                  name: row.email,
                  code: 'M' + row.email.length,
                })),
                coproducers: body.coproducers.map((row) => ({
                  ...row,
                  name: row.email,
                })),
              }
            : {
                ...state[key],
                ...body,
                version: body.version + 1,
                affiliates: body.affiliates.map((row) => ({
                  ...row,
                  name: row.email,
                  code: 'N' + row.email.length,
                })),
              };
      return route.fulfill({ json: { data: state[key] } });
    }
    return route.fulfill({ json: { data: state[key] } });
  });
}

const baseCo = (participants = [], extra = {}) => ({
  basis: 'NET',
  version: 1,
  participants,
  ...extra,
});
const baseAff = (affiliates = [], extra = {}) => ({
  version: 1,
  defaultPercentageBps: null,
  commissionOnRenewals: null,
  affiliates,
  ...extra,
});
const ana = (bps) => ({
  email: 'ana@local.test',
  name: 'Ana',
  percentageBps: bps,
});
const anaAff = (bps) => ({ ...ana(bps), code: 'ANA123' });
const bruno = (bps) => ({
  email: 'bruno@local.test',
  name: 'Bruno',
  code: 'BRU456',
  percentageBps: bps,
});
const baseMargin = (extra = {}) => ({
  version: 1,
  defaultPercentageBps: null,
  commissionOnRenewals: true,
  affiliates: [],
  coproducers: [],
  ...extra,
});
const total = (page) => page.getByTestId('participation-total').innerText();
const owner = (page) => page.getByTestId('participation-owner').innerText();
const open = async (page, server, kind) => {
  await page.goto(`${server.url}?kind=${kind}`);
  await page
    .getByRole('button', { name: 'Participações', exact: true })
    .click();
  await page.getByRole('button', { name: 'Adicionar pessoa' }).waitFor();
  await page.getByTestId('participation-total').waitFor();
};
const newPage = async (
  browser,
  state,
  viewport = { width: 390, height: 844 },
) => {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(30000);
  await mock(page, state);
  return page;
};
const run = async (fn) => {
  const { server, browser } = await serve();
  try {
    await fn({ server, browser });
  } finally {
    await browser.close();
    server.stop(true);
  }
};

test('one modal without tabs: people list with chips, submodal edit with discard, one Salvar splitting only changed agreements', async () => {
  await run(async ({ server, browser }) => {
    const state = {
      co: baseCo([ana(4000)], { mode: 'OWN', effective: null }),
      aff: baseAff([bruno(3000), anaAff(500)], {
        inherited: {
          defaultPercentageBps: null,
          commissionOnRenewals: true,
          affiliates: [{ name: 'Caio', code: 'CAIO99', percentageBps: 500 }],
        },
      }),
    };
    const page = await newPage(browser, state);
    await open(page, server, 'ofertas');
    expect(new URL(page.url()).searchParams.get('modal')).toBe(
      'participations',
    );
    expect(await page.getByRole('tab').count()).toBe(0);
    await page.getByText('Coprodutor · Produto 40%').waitFor();
    await page.getByText('Afiliado · Produto 30%', { exact: true }).waitFor();
    await page.getByText('Caio · Afiliado · Produto 5%').waitFor();
    // pior caso: 40% + Bruno 30%
    expect(await total(page)).toBe('70%');
    expect(await owner(page)).toBe('30%');

    // submodal: discard restores
    await page.getByRole('button', { name: 'Editar Ana' }).click();
    expect(new URL(page.url()).searchParams.get('modal')).toBe(
      'participations-person',
    );
    await page.getByRole('textbox', { name: 'Percentual' }).first().fill('10');
    await page.getByRole('textbox', { name: 'Percentual' }).first().blur();
    await page.getByRole('button', { name: 'Descartar' }).click();
    await page.getByText('Coprodutor · Produto 40%').waitFor();
    expect(new URL(page.url()).searchParams.get('modal')).toBe(
      'participations',
    );
    expect(await total(page)).toBe('70%');

    // submodal: over 100% blocks, then fix and save
    await page.getByRole('button', { name: 'Editar Ana' }).click();
    await page.getByRole('textbox', { name: 'Percentual' }).first().fill('80');
    await page.getByRole('textbox', { name: 'Percentual' }).first().blur();
    await page.getByRole('alert').waitFor();
    expect(
      await page
        .getByRole('button', { name: 'Salvar', exact: true })
        .isDisabled(),
    ).toBe(true);
    await page.getByRole('textbox', { name: 'Percentual' }).first().fill('25');
    await page.getByRole('textbox', { name: 'Percentual' }).first().blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Coprodutor · Produto 25%').waitFor();
    expect(state.writes.length).toBe(0);
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Participações salvas').waitFor();
    expect(state.writes.map((item) => item.key)).toEqual(['co']);
    expect(state.writes[0].body.participants).toEqual([
      { email: 'ana@local.test', percentageBps: 2500 },
    ]);
    await page.close();
  });
}, 180000);

test('add a person with both product shares and a 404 is an error, never an empty agreement', async () => {
  await run(async ({ server, browser }) => {
    const state = {
      co: baseCo([], { mode: 'OWN', effective: null }),
      aff: baseAff(),
      loadError: { aff: 404 },
    };
    const page = await newPage(browser, state);
    await page.goto(`${server.url}?kind=ofertas`);
    await page
      .getByRole('button', { name: 'Participações', exact: true })
      .click();
    await page.getByText(/Não foi possível carregar os afiliados/).waitFor();
    expect(await page.getByRole('button', { name: 'Salvar' }).count()).toBe(0);
    state.loadError = {};
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByRole('button', { name: 'Adicionar pessoa' }).waitFor();
    await page.getByRole('button', { name: 'Adicionar pessoa' }).click();
    await page.getByRole('combobox', { name: /Pessoa/ }).click();
    await page.getByText('ana@local.test').click();
    await page.getByRole('switch', { name: 'Coprodutor · Produto' }).click();
    await page.getByRole('textbox', { name: 'Percentual' }).fill('10');
    await page.getByRole('textbox', { name: 'Percentual' }).blur();
    await page.getByRole('switch', { name: 'Afiliado · Produto' }).click();
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).fill('5');
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Coprodutor · Produto 10%').waitFor();
    await page.getByText('Afiliado · Produto 5%', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Participações salvas').waitFor();
    expect(state.writes.map((item) => item.key)).toEqual(['co', 'aff']);
    await page.close();
  });
}, 180000);

test('non-admin never fetches or saves margin and sees no margin shares', async () => {
  await run(async ({ server, browser }) => {
    const state = {
      isAdmin: false,
      co: baseCo([ana(1000)], { mode: 'OWN' }),
      aff: baseAff([bruno(2000)]),
      margin: baseMargin({
        coproducers: [
          { email: 'dani@local.test', name: 'Dani', percentageBps: 2000 },
        ],
      }),
    };
    const page = await newPage(browser, state);
    await open(page, server, 'plataformas');
    expect(state.requests.some((item) => item.includes('/margem/'))).toBe(
      false,
    );
    expect(await page.getByText('Dani').count()).toBe(0);
    expect(await page.getByTestId('margin-affiliate-total').count()).toBe(0);
    await page.getByRole('button', { name: 'Editar Ana' }).click();
    expect(await page.getByRole('switch', { name: /Margem/ }).count()).toBe(0);
    await page.getByRole('textbox', { name: 'Percentual' }).first().fill('15');
    await page.getByRole('textbox', { name: 'Percentual' }).first().blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Participações salvas').waitFor();
    expect(state.writes.map((item) => item.key)).toEqual(['co']);
    await page.close();
  });
}, 180000);

test('admin: margin shares, independent margin indicator, sequential saves with partial failure and reload on 409', async () => {
  await run(async ({ server, browser }) => {
    const state = {
      isAdmin: true,
      co: baseCo([ana(1000)], { mode: 'OWN' }),
      aff: baseAff([bruno(2000)]),
      margin: baseMargin({
        defaultPercentageBps: 3000,
        affiliates: [
          {
            email: 'bruno@local.test',
            name: 'Bruno',
            code: 'M1',
            percentageBps: null,
          },
        ],
        coproducers: [
          { email: 'ana@local.test', name: 'Ana', percentageBps: 2000 },
        ],
      }),
    };
    const page = await newPage(browser, state);
    await open(page, server, 'plataformas');
    await page.getByText('Coprodutor · Margem 20%').waitFor();
    await page.getByText('Afiliado · Margem padrão 30%').waitFor();
    // 20% coprodutor + Bruno 30% (padrão)
    expect(await page.getByTestId('margin-affiliate-total').innerText()).toBe(
      '50%',
    );

    await page.getByRole('button', { name: 'Editar Ana' }).click();
    await page.getByRole('switch', { name: 'Afiliado · Produto' }).click();
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).fill('5');
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('button', { name: 'Editar Bruno' }).click();
    await page
      .getByRole('switch', { name: 'Coprodutor · Margem SimIntPay' })
      .click();
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).fill('10');
    await page.getByRole('textbox', { name: 'Percentual' }).nth(1).blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    // Salvar grava aff e margin, nessa ordem
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Participações salvas').waitFor();
    expect(state.writes.map((item) => item.key)).toEqual(['aff', 'margin']);
    expect(state.writes[1].body.coproducers).toEqual([
      { email: 'ana@local.test', percentageBps: 2000 },
      { email: 'bruno@local.test', percentageBps: 1000 },
    ]);
    expect(state.writes[1].body.affiliates).toEqual([
      { email: 'bruno@local.test', percentageBps: null },
    ]);
    // Bruno virou coprodutor da margem: só os coprodutores contam (30%)
    expect(await page.getByTestId('margin-affiliate-total').innerText()).toBe(
      '30%',
    );
    await page.close();
  });
}, 180000);

test('admin: a failing later agreement reports what was saved, keeps the draft and reloads on 409', async () => {
  await run(async ({ server, browser }) => {
    const state = {
      isAdmin: true,
      co: baseCo([ana(1000)], { mode: 'OWN' }),
      aff: baseAff([bruno(2000)]),
      margin: baseMargin({ defaultPercentageBps: 3000 }),
      failNext: [],
    };
    const page = await newPage(browser, state);
    await open(page, server, 'plataformas');
    await page.getByRole('button', { name: 'Editar Ana' }).click();
    await page.getByRole('textbox', { name: 'Percentual' }).first().fill('11');
    await page.getByRole('textbox', { name: 'Percentual' }).first().blur();
    await page
      .getByRole('switch', { name: 'Coprodutor · Margem SimIntPay' })
      .click();
    await page.getByRole('textbox', { name: 'Percentual' }).last().fill('10');
    await page.getByRole('textbox', { name: 'Percentual' }).last().blur();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    state.failNext.push(undefined, {
      status: 409,
      message: 'Versão antiga',
      reload: { version: 7 },
    });
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText(/Já salvo: Co-produção/).waitFor();
    await page.getByRole('button', { name: 'Recarregar configuração' }).click();
    await page.getByText('Configuração recarregada').waitFor();
    await page.close();
  });
}, 180000);
