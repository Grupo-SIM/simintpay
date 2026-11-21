import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  CoproductionService,
  captureCoproduction,
} from '../coproduction/coproduction.service';
import { productTables, type ProductKey } from '../coproduction/coproduction';
import {
  emptyConfig,
  generateAffiliateCode,
  validateAffiliateInput,
  worstPercentage,
  type AffiliateConfig,
  type AffiliateProduct,
} from './affiliate';
import { platformIdOfOffer, readAffiliateConfig } from './affiliate-capture';

type Tx = Prisma.TransactionClient;
type Scope = {
  ownerId: string;
  /** Platform that owns the codes; null for an offer outside any platform. */
  platformId: string | null;
  platformTag: string | null;
};
type Person = { id: string; name: string; email: string };

@Injectable()
export class AffiliateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coproduction: CoproductionService,
  ) {}

  accounts(actorId: string, search?: string, page?: string) {
    return this.coproduction.accounts(actorId, search, page);
  }

  /** Same security as the coproduction: approved owner or active admin of the product. */
  private async authorize(
    tx: Tx,
    actorId: string,
    product: AffiliateProduct,
    id: string,
  ): Promise<Scope> {
    const table = Prisma.raw(`"${productTables[product]}"`);
    const extra =
      product === 'plataformas'
        ? Prisma.sql`, tag`
        : Prisma.sql`, "platformTag" AS tag`;
    const rows = await tx.$queryRaw<{ userId: string; tag: string | null }[]>(
      Prisma.sql`SELECT "ownerUserId" AS "userId"${extra} FROM ${table} WHERE id = ${id} FOR SHARE`,
    );
    if (!rows.length) throw new NotFoundException('Produto não encontrado');
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (
      !actor?.isActive ||
      actor.isPurged ||
      (actor.role !== 'ADMIN' &&
        (actor.clientStatus !== 'APPROVED' || rows[0].userId !== actorId))
    )
      throw new ForbiddenException(
        'Afiliados restritos ao proprietário aprovado ou administrador',
      );
    const platformId =
      product === 'plataformas'
        ? id
        : await platformIdOfOffer(tx, id, rows[0].tag ?? undefined);
    const tag =
      product === 'plataformas'
        ? rows[0].tag
        : platformId
          ? ((
              await tx.$queryRaw<
                { tag: string }[]
              >`SELECT tag FROM "Platform" WHERE id = ${platformId}`
            )[0]?.tag ?? null)
          : null;
    return { ownerId: rows[0].userId, platformId, platformTag: tag };
  }

  private async people(tx: Tx, ids: string[]): Promise<Map<string, Person>> {
    const users = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private async codes(tx: Tx, platformId: string | null) {
    if (!platformId) return new Map<string, string>();
    const rows = await tx.$queryRaw<
      { userId: string; code: string }[]
    >`SELECT "userId", code FROM "AffiliateCode" WHERE "platformId" = ${platformId}`;
    return new Map(rows.map((r) => [r.userId, r.code]));
  }

  private async present(
    tx: Tx,
    product: AffiliateProduct,
    scope: Scope,
    saved: AffiliateConfig,
    platform: AffiliateConfig | null,
  ) {
    const ids = [
      ...saved.affiliates.map((a) => a.userId),
      ...(platform?.affiliates ?? []).map((a) => a.userId),
    ];
    const [people, codes] = await Promise.all([
      this.people(tx, ids),
      this.codes(tx, scope.platformId),
    ]);
    const person = (id: string) => {
      const p = people.get(id);
      if (!p) throw new ConflictException('Conta de afiliado indisponível');
      return p;
    };
    return {
      data: {
        version: saved.version,
        defaultPercentageBps: saved.defaultPercentageBps,
        commissionOnRenewals: saved.commissionOnRenewals,
        ...(product === 'plataformas'
          ? { linkBaseUrl: saved.linkBaseUrl }
          : {}),
        affiliates: saved.affiliates.map((a) => ({
          email: person(a.userId).email,
          name: person(a.userId).name,
          code: codes.get(a.userId) ?? null,
          percentageBps: a.percentageBps,
        })),
        ...(product === 'ofertas'
          ? {
              inherited: {
                defaultPercentageBps: platform?.defaultPercentageBps ?? null,
                commissionOnRenewals: platform?.commissionOnRenewals ?? true,
                affiliates: (platform?.affiliates ?? []).map((a) => ({
                  name: person(a.userId).name,
                  code: codes.get(a.userId) ?? null,
                  percentageBps: a.percentageBps,
                })),
              },
            }
          : {}),
      },
    };
  }

  get(actorId: string, product: AffiliateProduct, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.authorize(tx, actorId, product, id);
      const saved =
        (await readAffiliateConfig(tx, product, id)) ?? emptyConfig(product);
      const platform =
        product === 'ofertas' && scope.platformId
          ? await readAffiliateConfig(tx, 'plataformas', scope.platformId)
          : null;
      return this.present(tx, product, scope, saved, platform);
    });
  }

  async save(
    actorId: string,
    product: AffiliateProduct,
    id: string,
    body: unknown,
  ) {
    const input = validateAffiliateInput(body, product);
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.authorize(tx, actorId, product, id);
      if (!scope.platformId)
        throw new BadRequestException(
          'Afiliados exigem uma oferta vinculada a uma plataforma ativa',
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`affiliate:${scope.platformId}`}, 0))::text`;
      const previous =
        (await readAffiliateConfig(tx, product, id)) ?? emptyConfig(product);
      if (previous.version !== input.version)
        throw new ConflictException(
          'Configuração alterada por outra sessão. Recarregue antes de salvar.',
        );
      const affiliates: AffiliateConfig['affiliates'] = [];
      for (const entry of input.affiliates) {
        const users = await tx.user.findMany({
          where: { email: { equals: entry.email, mode: 'insensitive' } },
          select: {
            id: true,
            isActive: true,
            isPurged: true,
            clientStatus: true,
            role: true,
          },
        });
        const user = users[0];
        if (
          users.length !== 1 ||
          !user.isActive ||
          user.isPurged ||
          user.clientStatus !== 'APPROVED' ||
          user.role !== 'USER'
        )
          throw new BadRequestException(
            'Afiliado deve ter uma conta cliente ativa e aprovada',
          );
        if (
          user.id === scope.ownerId ||
          affiliates.some((a) => a.userId === user.id)
        )
          throw new BadRequestException('Proprietário ou afiliado duplicado');
        affiliates.push({
          userId: user.id,
          percentageBps: entry.percentageBps,
        });
      }
      const next: AffiliateConfig = {
        version: previous.version + 1,
        defaultPercentageBps: input.defaultPercentageBps,
        commissionOnRenewals: input.commissionOnRenewals,
        linkBaseUrl: input.linkBaseUrl,
        affiliates,
      };
      await this.assertWorstCase(tx, product, id, scope, next);
      for (const a of affiliates)
        await this.ensureCode(tx, scope.platformId, a.userId);
      const list = JSON.stringify(affiliates);
      await tx.$executeRaw`INSERT INTO "AffiliateAgreement" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", "linkBaseUrl", affiliates, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${next.linkBaseUrl}, ${list}::jsonb, ${actorId})
        ON CONFLICT (product, "productId") DO UPDATE SET version = EXCLUDED.version, "defaultPercentageBps" = EXCLUDED."defaultPercentageBps", "commissionOnRenewals" = EXCLUDED."commissionOnRenewals", "linkBaseUrl" = EXCLUDED."linkBaseUrl", affiliates = EXCLUDED.affiliates, "actorId" = EXCLUDED."actorId", "updatedAt" = now()`;
      await tx.$executeRaw`INSERT INTO "AffiliateAgreementRevision" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", "linkBaseUrl", affiliates, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${next.linkBaseUrl}, ${list}::jsonb, ${actorId})`;
      const platform =
        product === 'ofertas'
          ? await readAffiliateConfig(tx, 'plataformas', scope.platformId)
          : null;
      return this.present(tx, product, scope, next, platform);
    });
  }

  /**
   * One code names one person, so the worst sale carries the highest effective percentage of any
   * listed person plus the coproducers of that sale. Offers on the platform are checked too.
   */
  private async assertWorstCase(
    tx: Tx,
    product: AffiliateProduct,
    id: string,
    scope: Scope,
    next: AffiliateConfig,
  ) {
    const fail = () => {
      throw new BadRequestException(
        'Afiliado somado à co-produção não pode ultrapassar 100% do líquido',
      );
    };
    const coTotal = async (
      key: ProductKey,
      productId: string,
      owner: string,
      tag?: string,
    ) =>
      (
        (await captureCoproduction(tx, key, productId, owner, tag))
          ?.participants ?? []
      ).reduce((sum, p) => sum + p.percentageBps, 0);
    if (product === 'ofertas') {
      const platform = await readAffiliateConfig(
        tx,
        'plataformas',
        scope.platformId!,
      );
      const total = await coTotal(
        'ofertas',
        id,
        scope.ownerId,
        scope.platformTag ?? undefined,
      );
      if (worstPercentage(next, platform) + total > 10000) fail();
      return;
    }
    const own = await coTotal('plataformas', id, scope.ownerId);
    if (worstPercentage(null, next) + own > 10000) fail();
    const offers = await tx.$queryRaw<{ id: string; ownerUserId: string }[]>`
      SELECT o.id, o."ownerUserId" FROM "Offer" o
      WHERE o."platformTag" = ${scope.platformTag}
        AND (EXISTS (SELECT 1 FROM "AffiliateAgreement" a WHERE a.product = 'ofertas' AND a."productId" = o.id)
          OR EXISTS (SELECT 1 FROM "CoproductionAgreement" c WHERE c.product = 'ofertas' AND c."productId" = o.id))`;
    for (const offer of offers) {
      const config = await readAffiliateConfig(tx, 'ofertas', offer.id);
      const total = await coTotal(
        'ofertas',
        offer.id,
        offer.ownerUserId,
        scope.platformTag ?? undefined,
      );
      if (worstPercentage(config, next) + total > 10000) fail();
    }
  }

  /** Stable per (platform, person); created the first time the person joins any list. */
  private async ensureCode(tx: Tx, platformId: string, userId: string) {
    const existing = await tx.$queryRaw<
      { code: string }[]
    >`SELECT code FROM "AffiliateCode" WHERE "platformId" = ${platformId} AND "userId" = ${userId}`;
    if (existing.length) return existing[0].code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateAffiliateCode(randomBytes);
      const inserted =
        await tx.$executeRaw`INSERT INTO "AffiliateCode" ("platformId", "userId", code) VALUES (${platformId}, ${userId}, ${code}) ON CONFLICT DO NOTHING`;
      if (inserted) return code;
    }
    throw new ConflictException('Não foi possível gerar o código do afiliado');
  }

  async receipts(actorId: string, pageValue = '1') {
    if (
      typeof pageValue !== 'string' ||
      !/^[1-9]\d*$/.test(pageValue) ||
      !Number.isSafeInteger(Number(pageValue)) ||
      Number(pageValue) > 1000000
    )
      throw new BadRequestException('Página inválida');
    const page = Number(pageValue),
      offset = (page - 1) * 10;
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await tx.user.findUnique({ where: { id: actorId } });
        if (
          !actor?.isActive ||
          actor.isPurged ||
          actor.role !== 'USER' ||
          actor.clientStatus !== 'APPROVED'
        )
          throw new ForbiddenException(
            'Recebimentos exclusivos de clientes aprovados',
          );
        const [totals, rows] = await Promise.all([
          tx.$queryRaw<
            {
              count: bigint;
              available: Prisma.Decimal;
              locked: Prisma.Decimal;
              reversed: Prisma.Decimal;
            }[]
          >`SELECT count(*) AS count,
            coalesce(sum(a.amount) FILTER (WHERE a.state = 'AVAILABLE'), 0) AS available,
            coalesce(sum(a.amount) FILTER (WHERE a.state = 'LOCKED'), 0) AS locked,
            coalesce(sum(a.amount) FILTER (WHERE a.state = 'REVERSED'), 0) AS reversed
            FROM "AffiliateAllocation" a WHERE a."userId" = ${actorId}`,
          tx.$queryRaw<
            {
              transactionId: string;
              amount: Prisma.Decimal;
              state: string;
              isRenewal: boolean;
              createdAt: Date;
              originName: string | null;
            }[]
          >`SELECT a."transactionId", a.amount, a.state, a."isRenewal", a."createdAt", coalesce(o.name, pl.name) AS "originName"
            FROM "AffiliateAllocation" a JOIN "Transaction" t ON t.id = a."transactionId"
            LEFT JOIN "Offer" o ON o.id = t."offerId"
            LEFT JOIN "Platform" pl ON pl.tag = t."platformTag"
            WHERE a."userId" = ${actorId}
            ORDER BY a."createdAt" DESC, a."transactionId" ASC LIMIT 10 OFFSET ${offset}`,
        ]);
        const cents = (amount: Prisma.Decimal) =>
          new Prisma.Decimal(amount).mul(100).toNumber();
        return {
          data: rows.map(({ amount, ...row }) => ({
            ...row,
            amountCents: cents(amount),
          })),
          summary: {
            creditedCents: cents(totals[0].available),
            lockedCents: cents(totals[0].locked),
            reversedCents: cents(totals[0].reversed),
          },
          total: Number(totals[0].count),
          page,
          pageSize: 10,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
