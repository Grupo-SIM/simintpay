import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { PlatformBetaiAdministrationService, type BetaiAdministrationOperation } from './platform-betai-administration.service';
import { BetaiAdminController } from '../../presentation/controllers/betai-admin.controller';
import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../platform-integrations/platform-integrations.store';
const originalToken = process.env.API_MACHINE_INTERNAL_TOKEN;
let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(async () => {
  process.env.API_MACHINE_INTERNAL_TOKEN = 'mock-legacy-token';
  await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [{ platform: { tag: 'BETAI' }, key: 'BACKEND_URL', url: 'https://mock-betai.invalid/' }] } } as any);
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ invoices: [{ valor: 0.29 }], ok: true }), { status: 200 }));
});
afterEach(() => { fetchSpy.mockRestore(); invalidatePlatformIntegrationsCache(); if (originalToken === undefined) delete process.env.API_MACHINE_INTERNAL_TOKEN; else process.env.API_MACHINE_INTERNAL_TOKEN = originalToken; });
const body = { valor: 0.29, vencimento: '2026-10-31', investidores: ['investor'] };
const cases: { handler: keyof BetaiAdminController; args: any[]; operation: BetaiAdministrationOperation; input?: any; method: string; path: string; body?: unknown }[] = [
  { handler: 'mensalidades', args: [], operation: 'invoices', method: 'GET', path: 'invoices' },
  { handler: 'run', args: [], operation: 'run', method: 'POST', path: 'run' },
  { handler: 'cobranca', args: [], operation: 'configuration', method: 'GET', path: 'cobranca' },
  { handler: 'saveCobranca', args: [body], operation: 'saveConfiguration', input: { body }, method: 'PUT', path: 'cobranca', body },
  { handler: 'investors', args: ['name + email@example.com'], operation: 'investors', input: { query: 'name + email@example.com' }, method: 'GET', path: 'investors?q=name%20%2B%20email%40example.com' },
  { handler: 'cobrar', args: [body], operation: 'charge', input: { body }, method: 'POST', path: 'cobrar', body },
  { handler: 'editMensalidade', args: ['invoice/a b', body], operation: 'editInvoice', input: { id: 'invoice/a b', body }, method: 'PATCH', path: 'invoices/invoice%2Fa%20b', body },
  { handler: 'deleteMensalidade', args: ['invoice/a b'], operation: 'deleteInvoice', input: { id: 'invoice/a b' }, method: 'DELETE', path: 'invoices/invoice%2Fa%20b' },
];
for (const c of cases) test(`BETAI admin alias ${c.handler} preserves characterized transport, raw units and envelope`, async () => {
  const contexts = { resolve: mock(async () => ({ id: 'p', tag: 'BETAI', ownerUserId: 'owner', acquirer: 'DOM' })) };
  const service = new PlatformBetaiAdministrationService(contexts as any);
  const controller = new BetaiAdminController(service);
  const result = await (controller[c.handler] as any)(...c.args);
  expect(result).toEqual(await service.legacy(c.operation, c.input));
  const [url, options] = fetchSpy.mock.calls[0] as any;
  expect(url).toBe('https://mock-betai.invalid/internal/mensalidade/' + c.path);
  expect(options.method ?? 'GET').toBe(c.method);
  expect(options.headers).toEqual({ ...(c.body ? { 'Content-Type': 'application/json' } : {}), 'x-internal-token': 'mock-legacy-token' });
  expect(options.body).toBe(c.body ? JSON.stringify(c.body) : undefined);
  expect(fetchSpy.mock.calls[0]).toEqual(fetchSpy.mock.calls[1]);
  expect(contexts.resolve).toHaveBeenCalledWith('BETAI');
});
test('BETAI admin legacy errors and null-body default remain unchanged; inactive product cannot call remote', async () => {
  const service = new PlatformBetaiAdministrationService({ resolve: async () => ({}) } as any);
  await service.legacy('saveConfiguration', { body: null });
  expect((fetchSpy.mock.calls[0] as any)[1].body).toBe('{}');
  fetchSpy.mockImplementation(async () => new Response('{}', { status: 503 }));
  await expect(service.legacy('run')).rejects.toThrow('Betai respondeu 503');
  const inactive = new PlatformBetaiAdministrationService({ resolve: async () => { throw new Error('Plataforma ou dono inativo'); } } as any);
  const count = fetchSpy.mock.calls.length;
  await expect(inactive.legacy('run')).rejects.toThrow('inativo');
  expect(fetchSpy.mock.calls).toHaveLength(count);
  invalidatePlatformIntegrationsCache();
  await expect(service.legacy('invoices')).rejects.toThrow('BETAI_URL não configurado no api-machine');
});
