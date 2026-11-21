import { expect, test } from 'bun:test';
import { chromium } from 'playwright-core';
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
          .getByRole('button', { name: 'Participações', exact: true })
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
