import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { expect, test, mock } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { ExternalPlatformDbService } from './external-platform-db.service';
import type { ExternalPlatformSlug } from './external-platform-db.types';

function fixture(slug: ExternalPlatformSlug, fail = false) {
  const sql: string[] = [];
  const client = { release: mock(() => {}), query: mock(async (query: string) => {
    sql.push(query);
    if (!query.includes('SELECT')) return { rows: [] };
    if (fail) throw new Error('timeout with private connection details');
    if (query.includes('Customer')) return { rows: [{ id: 'customer', name: 'Buyer' }] };
    if (slug === 'pagatg') return { rows: [{ id: 'seller', name: 'Operator' }] };
    return { rows: [{ id: 'seller', name: 'Seller', isVendedor: true, organizationName: slug === 'patrimonial' ? 'Fixture Company' : null }, { id: 'customer', name: 'Buyer', isVendedor: false }] };
  }) };
  const service = new ExternalPlatformDbService({} as never);
  (service as any).getPool = async () => ({ connect: async () => client });
  return { service, sql, client };
}
for (const slug of ['atlas', 'ebooksim', 'revalida', 'patrimonial', 'pagatg'] as ExternalPlatformSlug[]) {
  test(`${slug} preserves classification and executes only read-only queries`, async () => {
    const { service, sql, client } = fixture(slug);
    const result = await service.listUsers(slug);
    expect(result.state).toBe('available');
    expect(result.vendedores.map(p => p.id)).toEqual(['seller']);
    expect(result.usuariosComuns.map(p => p.id)).toEqual(['customer']);
    expect(result.tabelasSeparadas).toBe(slug === 'pagatg');
    expect(sql[0]).toBe('BEGIN READ ONLY');
    expect(sql[1]).toContain("statement_timeout = '5s'");
    expect(sql.at(-1)).toBe('COMMIT');
    if (slug === 'patrimonial') { expect(result.vendedores[0].organizationName).toBe('Fixture Company'); expect(sql.join(' ')).toContain('LEFT JOIN "Organization"'); }
    if (slug === 'atlas') expect(sql.join(' ')).toContain('affiliate_commissions');
    if (slug === 'revalida') expect(sql.join(' ')).toContain("role = 'admin'");
    if (['ebooksim', 'patrimonial'].includes(slug)) expect(sql.join(' ')).toContain("role = 'ADMIN'");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
}

test('areaflix: only parentAdminId-less operators count as vendedor, invited admins join usuariosComuns', async () => {
  const sql: string[] = [];
  const client = { release: mock(() => {}), query: mock(async (query: string) => {
    sql.push(query);
    if (!query.includes('SELECT')) return { rows: [] };
    if (query.includes('Customer')) return { rows: [{ id: 'buyer', name: 'Buyer' }] };
    if (query.includes('IS NOT NULL')) return { rows: [{ id: 'invited', name: 'Invited Admin' }] };
    if (query.includes('IS NULL')) return { rows: [{ id: 'owner', name: 'Owner' }] };
    return { rows: [] };
  }) };
  const service = new ExternalPlatformDbService({} as never);
  (service as any).getPool = async () => ({ connect: async () => client });
  const result = await service.listUsers('areaflix');
  expect(result.state).toBe('available');
  expect(result.tabelasSeparadas).toBe(true);
  expect(result.vendedores.map(p => p.id)).toEqual(['owner']);
  expect(result.usuariosComuns.map(p => p.id)).toEqual(['invited', 'buyer']);
});
test('invalid slug is 400; absent registration/configuration is unconfigured without connection', async () => {
  const service = new ExternalPlatformDbService({ platform: { findUnique: async () => null } } as never);
  await expect(service.listUsers('unknown' as ExternalPlatformSlug)).rejects.toBeInstanceOf(BadRequestException);
  expect((await service.listUsers('atlas')).state).toBe('unconfigured');
});
test('timeout rolls back and releases; partial failure does not look like valid empty data', async () => {
  const { service, sql, client } = fixture('pagatg', true);
  expect((await service.listUsers('pagatg')).state).toBe('unavailable');
  expect(sql.at(-1)).toBe('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
  (service as any).getPool = async (slug: string) => {
    if (slug === 'atlas') throw new Error('connection timeout');
    return null;
  };
  const all = await service.listAll();
  expect(all.find(p => p.platform === 'atlas')?.state).toBe('unavailable');
  expect(all.filter(p => p.state === 'unconfigured')).toHaveLength(5);
});
test('module shutdown closes every pool despite failure', async () => {
  const service = new ExternalPlatformDbService({} as never);
  const end = mock(async () => {});
  (service as any).pools.set('atlas', { pool: { end } });
  (service as any).pools.set('pagatg', { pool: { end: async () => { throw new Error('closed'); } } });
  await service.onModuleDestroy();
  expect(end).toHaveBeenCalledTimes(1);
});

test('encrypted configuration renews pools and deletion closes old pool without fallback env credentials', async () => {
  const previousKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  try {
    let value: string | null = encryptPlatformSecret('postgresql://local:fixture@127.0.0.1/first');
    const prisma: any = {
      platform: { findUnique: async () => ({ id: 'platform', isActive: true, owner: { isActive: true, isPurged: false } }) },
      platformIntegration: { findUnique: async () => value ? { encryptedValue: value } : null },
    };
    const service = new ExternalPlatformDbService(prisma);
    const pools: any[] = [];
    (service as any).createPool = (url: string) => { const pool = { url, end: mock(async () => {}), on: () => {} }; pools.push(pool); return pool; };
    const first = await (service as any).getPool('atlas');
    expect(first.url).toContain('/first');
    expect(await (service as any).getPool('atlas')).toBe(first);
    value = encryptPlatformSecret('postgresql://local:fixture@127.0.0.1/second');
    const second = await (service as any).getPool('atlas');
    expect(second.url).toContain('/second'); expect(first.end).toHaveBeenCalledTimes(1);
    value = null;
    expect(await (service as any).getPool('atlas')).toBeNull(); expect(second.end).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  } finally { if (previousKey === undefined) delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY; else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = previousKey; }
});
