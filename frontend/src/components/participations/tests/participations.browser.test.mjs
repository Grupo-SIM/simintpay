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
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: me });
    if (url.pathname.endsWith('/contas'))
      return route.fulfill({
        json: { data: accounts, total: 2, page: 1, pageSize: 20 },
      });
    const key = url.pathname.startsWith('/api/coproducao/') ? 'co' : 'aff';
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
          : {
              ...state.aff,
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
const total = (page) => page.getByTestId('participation-total').innerText();
const owner = (page) => page.getByTestId('participation-owner').innerText();
const open = async (page, server, kind) => {
  await page.goto(`${server.url}?kind=${kind}`);
  await page
    .getByRole('button', { name: 'Participações', exact: true })
    .click();
  await page.getByRole('tab', { name: 'Co-produção' }).waitFor();
  await page.getByTestId('participation-total').waitFor();
};

test('one dialog with tabs, no explanatory notice, joint total visible in both tabs and blocking above 100%', async () => {
  const { server, browser } = await serve();
  try {
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(30000);
      const state = {
        co: baseCo([ana(4000)], { mode: 'OWN', effective: null }),
        aff: baseAff([bruno(3000)], {
          inherited: {
            defaultPercentageBps: null,
            commissionOnRenewals: true,
            affiliates: [{ name: 'Caio', code: 'CAIO99', percentageBps: 500 }],
          },
        }),
      };
      await mock(page, state);
      await open(page, server, 'ofertas');
      expect(new URL(page.url()).searchParams.get('modal')).toBe(
        'participations',
      );
      // um único botão: os antigos saíram
      expect(
        await page
          .getByRole('button', { name: 'Afiliados', exact: true })
          .count(),
      ).toBe(0);
      expect(await page.getByRole('tab').count()).toBe(2);
      // avisos removidos
      for (const text of [
        'Afiliados valem em toda compra',
        'Afiliados desta oferta somam aos da plataforma',
        'sai da parte do proprietário',
        'Alterações valem para novas cobranças',
        'Adicione vários coprodutores',
        'Assinaturas já criadas seguem',
      ])
        expect(await page.getByText(text, { exact: false }).count()).toBe(0);
      // pior caso: 40% de coprodutores + maior afiliado (Bruno 30%; Caio 5%)
      expect(await total(page)).toBe('70%');
      expect(await owner(page)).toBe('30%');
      if (process.env.PARTICIPATIONS_SCREENSHOT_CSS)
        await page.screenshot({
          path: `/tmp/participations-offer-co-${viewport.width}.png`,
        });
      await page.getByRole('tab', { name: 'Afiliados' }).click();
      expect(await total(page)).toBe('70%');
      await page
        .getByText('Afiliados da plataforma (somente leitura)')
        .waitFor();
      await page.getByText('Caio — 5%').waitFor();
      expect(
        await page.getByRole('button', { name: 'Copiar código' }).count(),
      ).toBeGreaterThan(0);
      if (process.env.PARTICIPATIONS_SCREENSHOT_CSS)
        await page.screenshot({
          path: `/tmp/participations-offer-aff-${viewport.width}.png`,
        });
      // excede: Bruno 70% + Ana 40% = 110%
      await page
        .getByRole('textbox', { name: 'Percentual', exact: true })
        .fill('70');
      await page
        .getByRole('textbox', { name: 'Percentual', exact: true })
        .blur();
      await page
        .getByRole('alert')
        .filter({ hasText: '110%' })
        .first()
        .waitFor();
      expect(await total(page)).toBe('110%');
      expect(
        await page
          .getByRole('button', { name: 'Salvar afiliados' })
          .isDisabled(),
      ).toBe(true);
      const message = await page
        .getByRole('alert')
        .filter({ hasText: '110%' })
        .first()
        .innerText();
      expect(message).toContain('10% acima de 100%');
      expect(message).toContain('afiliado Bruno 70%');
      if (process.env.PARTICIPATIONS_SCREENSHOT_CSS)
        await page.screenshot({
          path: `/tmp/participations-offer-over-${viewport.width}.png`,
        });
      // a outra aba também fica bloqueada
      await page.getByRole('tab', { name: 'Co-produção' }).click();
      expect(await total(page)).toBe('110%');
      expect(
        await page
          .getByRole('button', { name: 'Salvar co-produção' })
          .isDisabled(),
      ).toBe(true);
      expect(state.writes).toEqual([]);
      // volta ao limite: libera
      await page.getByRole('textbox', { name: /Participação/ }).fill('30');
      await page.getByRole('textbox', { name: /Participação/ }).blur();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid=participation-total]')
            .textContent === '100%',
      );
      expect(
        await page
          .getByRole('button', { name: 'Salvar co-produção' })
          .isDisabled(),
      ).toBe(false);
      await page.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('the same person in both tabs counts once (tie keeps the coproducer; offer affiliate beats platform coproducer)', async () => {
  const { server, browser } = await serve();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(30000);
    const state = {
      co: baseCo([ana(6000)], { mode: 'OWN', effective: null }),
      aff: baseAff([anaAff(6000)]),
    };
    await mock(page, state);
    await open(page, server, 'ofertas');
    // empate no nível da oferta: vale o coprodutor, 60% e não 120%
    expect(await total(page)).toBe('60%');
    await page
      .getByRole('note')
      .filter({ hasText: 'conta uma vez só' })
      .waitFor();
    expect(
      await page
        .getByRole('button', { name: 'Salvar co-produção' })
        .isDisabled(),
    ).toBe(false);
    await page.getByRole('tab', { name: 'Afiliados' }).click();
    expect(
      await page.getByRole('button', { name: 'Salvar afiliados' }).isDisabled(),
    ).toBe(false);
    await page.close();

    // coprodutor herdado da plataforma, afiliado na oferta: o afiliado vence e troca a parte
    const page2 = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page2.setDefaultTimeout(30000);
    const inheritState = {
      co: baseCo([], {
        mode: 'INHERIT',
        effective: {
          source: { platformId: 'platform', version: 1 },
          participants: [
            ana(3000),
            { email: 'dani@local.test', name: 'Dani', percentageBps: 2000 },
          ],
        },
      }),
      aff: baseAff([anaAff(8000)]),
    };
    await mock(page2, inheritState);
    await open(page2, server, 'ofertas');
    // Ana (oferta) 80% substitui os 30% dela; sobram Dani 20% + Ana 80% = 100%
    expect(await total(page2)).toBe('100%');
    expect(await owner(page2)).toBe('0%');
    await page2.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('each tab saves its own configuration, dialog stays open, 409 reloads one tab and 400 keeps the draft', async () => {
  const { server, browser } = await serve();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(30000);
    const state = {
      co: baseCo([ana(2000)], { mode: 'OWN', effective: null }),
      aff: baseAff([bruno(1000)], { defaultPercentageBps: 500 }),
      failNext: [],
    };
    await mock(page, state);
    await open(page, server, 'ofertas');
    // co-produção
    await page.getByRole('textbox', { name: /Participação/ }).fill('25,50');
    await page.getByRole('textbox', { name: /Participação/ }).blur();
    await page.getByRole('button', { name: 'Salvar co-produção' }).click();
    await page.getByText('Co-produção salva').waitFor();
    expect(state.writes[0]).toEqual({
      key: 'co',
      body: {
        basis: 'NET',
        version: 1,
        mode: 'OWN',
        participants: [{ email: 'ana@local.test', percentageBps: 2550 }],
      },
    });
    expect(await page.getByRole('dialog').isVisible()).toBe(true);
    // afiliados: 400 do servidor preserva o rascunho
    await page.getByRole('tab', { name: 'Afiliados' }).click();
    await page.getByLabel('Percentual global').fill('12,5');
    state.failNext = [
      {
        status: 400,
        message:
          'Afiliado somado à co-produção não pode ultrapassar 100% do líquido',
      },
      {
        status: 409,
        message: 'Configuração alterada por outra sessão',
        reload: { version: 5, defaultPercentageBps: 700 },
      },
    ];
    await page.getByRole('button', { name: 'Salvar afiliados' }).click();
    await page
      .getByRole('alert')
      .filter({ hasText: 'não pode ultrapassar 100%' })
      .first()
      .waitFor();
    expect(await page.getByLabel('Percentual global').inputValue()).toBe(
      '12,5',
    );
    // 409: bloqueia até recarregar; a recarga troca só o rascunho dos afiliados
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
    await page.getByRole('button', { name: 'Salvar afiliados' }).click();
    await page.getByText('Afiliados salvos').waitFor();
    expect(state.writes.at(-1)).toEqual({
      key: 'aff',
      body: {
        version: 5,
        defaultPercentageBps: 700,
        commissionOnRenewals: null,
        affiliates: [{ email: 'bruno@local.test', percentageBps: 1000 }],
      },
    });
    // a co-produção salva continua com 25,50%
    await page.getByRole('tab', { name: 'Co-produção' }).click();
    expect(
      await page.getByRole('textbox', { name: /Participação/ }).inputValue(),
    ).toBe('25,5');
    await page.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('a 404 on either module is an error, never an empty agreement', async () => {
  const { server, browser } = await serve();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(30000);
    const state = {
      co: baseCo([], { mode: 'OWN', effective: null }),
      aff: baseAff(),
      loadError: { aff: 404 },
    };
    await mock(page, state);
    await page.goto(`${server.url}?kind=ofertas`);
    await page
      .getByRole('button', { name: 'Participações', exact: true })
      .click();
    await page.getByText(/Não foi possível carregar os afiliados/).waitFor();
    expect(await page.getByRole('tab').count()).toBe(0);
    expect(await page.getByRole('button', { name: /Salvar/ }).count()).toBe(0);
    state.loadError = {};
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await page.getByRole('tab', { name: 'Afiliados' }).waitFor();
    await page.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);

test('platform: link base, copyable code and joint total without inheritance controls', async () => {
  const { server, browser } = await serve();
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(30000);
    const state = {
      co: baseCo([ana(1000)], { mode: 'OWN' }),
      aff: baseAff([bruno(2550)], {
        defaultPercentageBps: 1000,
        commissionOnRenewals: true,
        linkBaseUrl: 'https://loja.test',
      }),
    };
    await mock(page, state);
    await open(page, server, 'plataformas');
    expect(await total(page)).toBe('35,5%');
    expect(
      await page
        .getByRole('button', { name: 'Usar padrão da plataforma' })
        .count(),
    ).toBe(0);
    await page.getByRole('tab', { name: 'Afiliados' }).click();
    await page.getByText('BRU456').waitFor();
    expect(
      await page.getByRole('button', { name: 'Copiar link' }).count(),
    ).toBe(1);
    expect(await page.getByLabel('Link base').inputValue()).toBe(
      'https://loja.test',
    );
    if (process.env.PARTICIPATIONS_SCREENSHOT_CSS)
      await page.screenshot({ path: '/tmp/participations-platform-390.png' });
    // fechar pelo histórico
    await page.goBack();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.close();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 180000);
