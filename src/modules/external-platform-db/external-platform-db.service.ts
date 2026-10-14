import { BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { decryptPlatformSecret } from '../platform-integrations/platform-secrets';
import type {
  ExternalPlatformPerson,
  ExternalPlatformSlug,
  ExternalPlatformUsersResult,
} from './external-platform-db.types';

@Injectable()
export class ExternalPlatformDbService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalPlatformDbService.name);
  constructor(private readonly prisma: PrismaService) {}
  private readonly pools = new Map<ExternalPlatformSlug, { url: string; pool: Pool }>();
  private readonly configuring = new Map<ExternalPlatformSlug, Promise<Pool | null>>();
  private readonly tags: Record<ExternalPlatformSlug, string> = {
    atlas: 'ATLAS', ebooksim: 'EBOOK', revalida: 'REVALIDA',
    // Platform.tag real no banco é CONTROLE-PATRIMONIAL, não PATRIMONIAL.
    patrimonial: 'CONTROLE-PATRIMONIAL', pagatg: 'PAGATG', areaflix: 'AREAFLIX',
  };

  private async getPool(slug: ExternalPlatformSlug): Promise<Pool | null> {
    const running = this.configuring.get(slug);
    if (running) return running;
    const task = this.configurePool(slug).finally(() => this.configuring.delete(slug));
    this.configuring.set(slug, task);
    return task;
  }

  private async configurePool(slug: ExternalPlatformSlug): Promise<Pool | null> {
    const platform = await this.prisma.platform.findUnique({ where: { tag: this.tags[slug] }, include: { owner: true } });
    const integration = platform?.isActive && platform.owner.isActive && !platform.owner.isPurged
      ? await this.prisma.platformIntegration.findUnique({ where: { platformId_key: { platformId: platform.id, key: 'EXTERNAL_DATABASE_URL' } } })
      : null;
    const connectionString = integration?.encryptedValue ? decryptPlatformSecret(integration.encryptedValue) : null;
    const existing = this.pools.get(slug);
    if (existing && existing.url === connectionString) return existing.pool;
    if (existing) { this.pools.delete(slug); await existing.pool.end(); }
    if (!connectionString) return null;
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database protocol');
    const pool = this.createPool(connectionString);
    // Never log driver errors: they may contain credentials or query data.
    pool.on('error', () => this.logger.error(`[${slug}] Banco externo indisponível`));
    this.pools.set(slug, { url: connectionString, pool });
    return pool;
  }

  private createPool(connectionString: string): Pool {
    return new Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 5_000 });
  }

  async onModuleDestroy() {
    await Promise.allSettled([...this.configuring.values()]);
    await Promise.all([...this.pools.values()].map(({ pool }) => pool.end().catch(() => undefined)));
    this.pools.clear();
  }

  /** Lista usuários de uma plataforma, já separados em vendedores/usuários comuns. */
  async listUsers(slug: ExternalPlatformSlug): Promise<ExternalPlatformUsersResult> {
    const empty: ExternalPlatformUsersResult = {
      platform: slug,
      state: 'unconfigured',
      vendedores: [],
      usuariosComuns: [],
      tabelasSeparadas: false,
    };

    if (!Object.prototype.hasOwnProperty.call(this.tags, slug)) throw new BadRequestException('Plataforma inválida');
    let client: PoolClient | undefined;
    try {
      const pool = await this.getPool(slug);
      if (!pool) return empty;
      client = await pool.connect();
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      let result: ExternalPlatformUsersResult;
      switch (slug) {
        case 'atlas': result = await this.listAtlas(client); break;
        case 'ebooksim': result = await this.listEbooksim(client); break;
        case 'revalida': result = await this.listRevalida(client); break;
        case 'patrimonial': result = await this.listPatrimonial(client); break;
        case 'pagatg': result = await this.listPagatg(client); break;
        case 'areaflix': result = await this.listAreaflix(client); break;
      }
      await client.query('COMMIT');
      return { ...result!, state: 'available' };
    } catch {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error(`[${slug}] Banco externo indisponível`);
      return { ...empty, state: 'unavailable' };
    } finally { client?.release(); }
  }

  async listAll(): Promise<ExternalPlatformUsersResult[]> {
    const slugs: ExternalPlatformSlug[] = [
      'atlas',
      'ebooksim',
      'revalida',
      'patrimonial',
      'pagatg',
      'areaflix',
    ];
    return Promise.all(slugs.map((s) => this.listUsers(s)));
  }

  // ── Atlas: vendedor = tem comissão de afiliado registrada ────────────────
  private async listAtlas(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.created_at AS "createdAt",
        (ac.affiliate_user_id IS NOT NULL) AS "isVendedor"
      FROM users u
      LEFT JOIN (SELECT DISTINCT affiliate_user_id FROM affiliate_commissions) ac
        ON ac.affiliate_user_id = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY "isVendedor" DESC, u.name
    `);
    return this.splitByFlag('atlas', rows);
  }

  // ── EbookSim: vendedor = role ADMIN (afiliado por comissão ainda não é usado em produção) ──
  private async listEbooksim(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const { rows } = await pool.query(`
      SELECT id, name, email, cpf, cnpj, "isActive", "createdAt",
        (role = 'ADMIN') AS "isVendedor"
      FROM users
      ORDER BY "isVendedor" DESC, name
    `);
    return this.splitByFlag('ebooksim', rows);
  }

  // ── Revalida: vendedor = role admin ───────────────────────────────────────
  private async listRevalida(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const { rows } = await pool.query(`
      SELECT id, name, email, "createdAt",
        (role = 'admin') AS "isVendedor"
      FROM users
      ORDER BY "isVendedor" DESC, name
    `);
    return this.splitByFlag('revalida', rows);
  }

  // ── Patrimonial: multi-tenant por Organization. O "assinante" é quem tem
  // role=ADMIN dentro de cada organização — é essa conta que fechou o SaaS
  // com a Simintpay; USER é quem o assinante convidou pra usar por baixo dele. ──
  private async listPatrimonial(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.cpf, u.cnpj, u."isActive", u."createdAt",
        o.name AS "organizationName",
        (u.role = 'ADMIN') AS "isVendedor"
      FROM "User" u
      LEFT JOIN "Organization" o ON o.id = u."organizationId"
      ORDER BY "isVendedor" DESC, u.name
    `);
    return this.splitByFlag('patrimonial', rows);
  }

  // ── Pagatg: "User" = dono/operador do bot; "CustomerTelegram" = cliente final ──
  private async listPagatg(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const [vendedores, usuariosComuns] = await Promise.all([
      pool.query(`
        SELECT id, name, email, cpf, cnpj, "isActive", "createdAt"
        FROM "User"
        ORDER BY name
      `),
      pool.query(`
        SELECT id, name, "createdAt"
        FROM "CustomerTelegram"
        ORDER BY name
      `),
    ]);
    return {
      platform: 'pagatg',
      state: 'available',
      vendedores: vendedores.rows.map(this.toPerson),
      usuariosComuns: usuariosComuns.rows.map(this.toPerson),
      tabelasSeparadas: true,
    };
  }

  // ── Areaflix: "User" = operador, mas só quem não foi convidado por outro
  // admin (parentAdminId IS NULL) é operador de verdade — quem tem
  // parentAdminId é equipe de um operador, não assinante próprio, então
  // entra junto com "Customer" (assinante final) do lado dos usuários comuns. ──
  private async listAreaflix(pool: PoolClient): Promise<ExternalPlatformUsersResult> {
    const [operadores, equipe, usuariosComuns] = await Promise.all([
      pool.query(`
        SELECT id, name, email, "createdAt"
        FROM "User"
        WHERE "parentAdminId" IS NULL
        ORDER BY name
      `),
      pool.query(`
        SELECT id, name, email, "createdAt"
        FROM "User"
        WHERE "parentAdminId" IS NOT NULL
        ORDER BY name
      `),
      pool.query(`
        SELECT id, name, email, "createdAt"
        FROM "Customer"
        ORDER BY name
      `),
    ]);
    return {
      platform: 'areaflix',
      state: 'available',
      vendedores: operadores.rows.map(this.toPerson),
      usuariosComuns: [...equipe.rows, ...usuariosComuns.rows].map(this.toPerson),
      tabelasSeparadas: true,
    };
  }

  private splitByFlag(
    platform: ExternalPlatformSlug,
    rows: any[],
  ): ExternalPlatformUsersResult {
    const vendedores: ExternalPlatformPerson[] = [];
    const usuariosComuns: ExternalPlatformPerson[] = [];
    for (const row of rows) {
      const person = this.toPerson(row);
      if (row.isVendedor) vendedores.push(person);
      else usuariosComuns.push(person);
    }
    return { platform, state: 'available', vendedores, usuariosComuns, tabelasSeparadas: false };
  }

  private toPerson = (row: any): ExternalPlatformPerson => ({
    id: row.id,
    name: row.name ?? null,
    email: row.email ?? null,
    cpf: row.cpf ?? null,
    cnpj: row.cnpj ?? null,
    isActive: row.isActive ?? null,
    createdAt: row.createdAt ?? null,
    organizationName: row.organizationName ?? null,
  });
}
