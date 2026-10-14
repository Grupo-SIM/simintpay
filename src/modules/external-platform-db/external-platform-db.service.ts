import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  ExternalPlatformPerson,
  ExternalPlatformSlug,
  ExternalPlatformUsersResult,
} from './external-platform-db.types';

/**
 * ExternalPlatformDbService — leitura somente-leitura dos bancos Postgres de
 * cada SaaS externo (Atlas, EbookSim, Revalida, Patrimonial, Pagatg, Areaflix).
 *
 * Esses bancos rodam no MESMO servidor Postgres do simpay (container `postgres`,
 * hostname `postgresql` na rede Docker), cada um em seu próprio database.
 * Nenhum desses bancos é tocado pelo Prisma do simpay — usamos `pg` puro porque
 * cada SaaS tem um schema totalmente diferente (não vale gerar um Prisma Client
 * por plataforma só para 1-2 SELECTs).
 *
 * Config por env var `{SLUG}_DATABASE_URL`, ex.: ATLAS_DATABASE_URL.
 * Se a env var não existir, a plataforma é pulada (retorna listas vazias) em
 * vez de derrubar o admin inteiro — essas conexões são "best effort".
 */
@Injectable()
export class ExternalPlatformDbService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalPlatformDbService.name);
  private readonly pools = new Map<ExternalPlatformSlug, Pool>();

  private readonly ENV_KEYS: Record<ExternalPlatformSlug, string> = {
    atlas: 'ATLAS_DATABASE_URL',
    ebooksim: 'EBOOKSIM_DATABASE_URL',
    revalida: 'REVALIDA_DATABASE_URL',
    patrimonial: 'PATRIMONIAL_DATABASE_URL',
    pagatg: 'PAGATG_DATABASE_URL',
    areaflix: 'AREAFLIX_DATABASE_URL',
  };

  private getPool(slug: ExternalPlatformSlug): Pool | null {
    const existing = this.pools.get(slug);
    if (existing) return existing;

    const connectionString = process.env[this.ENV_KEYS[slug]];
    if (!connectionString) {
      this.logger.warn(`[${slug}] ${this.ENV_KEYS[slug]} não configurada — pulando.`);
      return null;
    }

    const pool = new Pool({
      connectionString,
      max: 2, // leitura ocasional no admin, não precisa de pool grande
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => this.logger.error(`[${slug}] Erro no pool: ${err.message}`));
    this.pools.set(slug, pool);
    return pool;
  }

  async onModuleDestroy() {
    await Promise.all([...this.pools.values()].map((p) => p.end().catch(() => undefined)));
  }

  /** Lista usuários de uma plataforma, já separados em vendedores/usuários comuns. */
  async listUsers(slug: ExternalPlatformSlug): Promise<ExternalPlatformUsersResult> {
    const empty: ExternalPlatformUsersResult = {
      platform: slug,
      vendedores: [],
      usuariosComuns: [],
      tabelasSeparadas: false,
    };

    const pool = this.getPool(slug);
    if (!pool) return empty;

    try {
      switch (slug) {
        case 'atlas':
          return await this.listAtlas(pool);
        case 'ebooksim':
          return await this.listEbooksim(pool);
        case 'revalida':
          return await this.listRevalida(pool);
        case 'patrimonial':
          return await this.listPatrimonial(pool);
        case 'pagatg':
          return await this.listPagatg(pool);
        case 'areaflix':
          return await this.listAreaflix(pool);
        default:
          return empty;
      }
    } catch (err: any) {
      this.logger.error(`[${slug}] Falha ao consultar banco externo: ${err.message}`);
      return empty;
    }
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
  private async listAtlas(pool: Pool): Promise<ExternalPlatformUsersResult> {
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
  private async listEbooksim(pool: Pool): Promise<ExternalPlatformUsersResult> {
    const { rows } = await pool.query(`
      SELECT id, name, email, cpf, cnpj, "isActive", "createdAt",
        (role = 'ADMIN') AS "isVendedor"
      FROM users
      ORDER BY "isVendedor" DESC, name
    `);
    return this.splitByFlag('ebooksim', rows);
  }

  // ── Revalida: vendedor = role admin ───────────────────────────────────────
  private async listRevalida(pool: Pool): Promise<ExternalPlatformUsersResult> {
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
  private async listPatrimonial(pool: Pool): Promise<ExternalPlatformUsersResult> {
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
  private async listPagatg(pool: Pool): Promise<ExternalPlatformUsersResult> {
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
      `).catch(() => ({ rows: [] })),
    ]);
    return {
      platform: 'pagatg',
      vendedores: vendedores.rows.map(this.toPerson),
      usuariosComuns: usuariosComuns.rows.map(this.toPerson),
      tabelasSeparadas: true,
    };
  }

  // ── Areaflix: "User" = operador; "Customer" = assinante final ────────────
  private async listAreaflix(pool: Pool): Promise<ExternalPlatformUsersResult> {
    const [vendedores, usuariosComuns] = await Promise.all([
      pool.query(`
        SELECT id, name, email, "createdAt"
        FROM "User"
        ORDER BY name
      `).catch(() => ({ rows: [] })),
      pool.query(`
        SELECT id, name, email, "createdAt"
        FROM "Customer"
        ORDER BY name
      `).catch(() => ({ rows: [] })),
    ]);
    return {
      platform: 'areaflix',
      vendedores: vendedores.rows.map(this.toPerson),
      usuariosComuns: usuariosComuns.rows.map(this.toPerson),
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
    return { platform, vendedores, usuariosComuns, tabelasSeparadas: false };
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
