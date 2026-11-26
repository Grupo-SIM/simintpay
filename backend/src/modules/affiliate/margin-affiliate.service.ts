import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { productTables } from '../coproduction/coproduction';
import { emptyConfig, type AffiliateProduct } from './affiliate';
import { ensureAffiliateCode } from './affiliate-code';
import { platformIdOfOffer } from './affiliate-platform';
import { readMarginConfig } from './margin-affiliate-capture';
import {
  marginWorstCaseBps,
  validateMarginInput,
  type MarginAffiliateConfig,
} from './margin-affiliate';

type Tx = Prisma.TransactionClient;
type Scope = { ownerId: string; platformId: string | null };

const emptyMargin = (product: AffiliateProduct): MarginAffiliateConfig => ({
  ...emptyConfig(product),
  coproducers: [],
});

const percent = (bps: number) =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** Affiliates paid from the SimIntPay margin. Only an active admin configures them. */
@Injectable()
export class MarginAffiliateService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorize(
    tx: Tx,
    actorId: string,
    product: AffiliateProduct,
    id: string,
  ): Promise<Scope> {
    const actor = await tx.user.findUnique({ where: { id: actorId } });
    if (!actor?.isActive || actor.isPurged || actor.role !== 'ADMIN')
      throw new ForbiddenException(
        'Afiliado SimIntPay restrito a administradores',
      );
    const table = Prisma.raw(`"${productTables[product]}"`);
    const extra =
      product === 'plataformas'
        ? Prisma.sql`, tag`
        : Prisma.sql`, "platformTag" AS tag`;
    const rows = await tx.$queryRaw<{ userId: string; tag: string | null }[]>(
      Prisma.sql`SELECT "ownerUserId" AS "userId"${extra} FROM ${table} WHERE id = ${id} FOR SHARE`,
    );
    if (!rows.length) throw new NotFoundException('Produto não encontrado');
    const platformId =
      product === 'plataformas'
        ? id
        : await platformIdOfOffer(tx, id, rows[0].tag ?? undefined);
    return { ownerId: rows[0].userId, platformId };
  }

  private async present(
    tx: Tx,
    product: AffiliateProduct,
    platformId: string | null,
    saved: MarginAffiliateConfig,
    platform: MarginAffiliateConfig | null,
  ) {
    const ids = [
      ...saved.affiliates.map((a) => a.userId),
      ...(platform?.affiliates ?? []).map((a) => a.userId),
      ...saved.coproducers.map((c) => c.userId),
      ...(platform?.coproducers ?? []).map((c) => c.userId),
    ];
    const users = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const people = new Map(users.map((u) => [u.id, u]));
    const codeRows = platformId
      ? await tx.$queryRaw<
          { userId: string; code: string }[]
        >`SELECT "userId", code FROM "AffiliateCode" WHERE "platformId" = ${platformId}`
      : [];
    const codes = new Map(codeRows.map((r) => [r.userId, r.code]));
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
        affiliates: saved.affiliates.map((a) => ({
          email: person(a.userId).email,
          name: person(a.userId).name,
          code: codes.get(a.userId) ?? null,
          percentageBps: a.percentageBps,
        })),
        coproducers: saved.coproducers.map((c) => ({
          email: person(c.userId).email,
          name: person(c.userId).name,
          percentageBps: c.percentageBps,
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
                coproducers: (platform?.coproducers ?? []).map((c) => ({
                  name: person(c.userId).name,
                  percentageBps: c.percentageBps,
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
        (await readMarginConfig(tx, product, id)) ?? emptyMargin(product);
      const platform =
        product === 'ofertas' && scope.platformId
          ? await readMarginConfig(tx, 'plataformas', scope.platformId)
          : null;
      return this.present(tx, product, scope.platformId, saved, platform);
    });
  }

  async save(
    actorId: string,
    product: AffiliateProduct,
    id: string,
    body: unknown,
  ) {
    if (body && typeof body === 'object' && 'linkBaseUrl' in body)
      throw new BadRequestException(
        'Afiliado SimIntPay não possui link base próprio',
      );
    const input = validateMarginInput(body, product);
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.authorize(tx, actorId, product, id);
      if (!scope.platformId)
        throw new BadRequestException(
          'Afiliados exigem uma oferta vinculada a uma plataforma ativa',
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`margin-affiliate:${scope.platformId}`}, 0))::text`;
      const previous =
        (await readMarginConfig(tx, product, id)) ?? emptyMargin(product);
      if (previous.version !== input.version)
        throw new ConflictException(
          'Configuração alterada por outra sessão. Recarregue antes de salvar.',
        );
      const resolve = async (email: string) => {
        const users = await tx.user.findMany({
          where: { email: { equals: email, mode: 'insensitive' } },
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
            'Participante deve ter uma conta cliente ativa e aprovada',
          );
        if (user.id === scope.ownerId)
          throw new BadRequestException('Proprietário não pode participar');
        return user.id;
      };
      const affiliates: MarginAffiliateConfig['affiliates'] = [];
      for (const entry of input.affiliates) {
        const userId = await resolve(entry.email);
        if (affiliates.some((a) => a.userId === userId))
          throw new BadRequestException('Afiliado duplicado');
        affiliates.push({ userId, percentageBps: entry.percentageBps });
      }
      const coproducers: MarginAffiliateConfig['coproducers'] = [];
      for (const entry of input.coproducers) {
        const userId = await resolve(entry.email);
        if (coproducers.some((c) => c.userId === userId))
          throw new BadRequestException('Coprodutor duplicado');
        coproducers.push({ userId, percentageBps: entry.percentageBps });
      }
      const next: MarginAffiliateConfig = {
        version: previous.version + 1,
        defaultPercentageBps: input.defaultPercentageBps,
        commissionOnRenewals: input.commissionOnRenewals,
        linkBaseUrl: null,
        affiliates,
        coproducers,
      };
      for (const a of affiliates)
        await ensureAffiliateCode(tx, scope.platformId, a.userId);
      const list = JSON.stringify(affiliates);
      const shares = JSON.stringify(coproducers);
      await tx.$executeRaw`INSERT INTO "MarginAffiliateAgreement" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", affiliates, coproducers, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${list}::jsonb, ${shares}::jsonb, ${actorId})
        ON CONFLICT (product, "productId") DO UPDATE SET version = EXCLUDED.version, "defaultPercentageBps" = EXCLUDED."defaultPercentageBps", "commissionOnRenewals" = EXCLUDED."commissionOnRenewals", affiliates = EXCLUDED.affiliates, coproducers = EXCLUDED.coproducers, "actorId" = EXCLUDED."actorId", "updatedAt" = now()`;
      await tx.$executeRaw`INSERT INTO "MarginAffiliateRevision" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", affiliates, coproducers, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${list}::jsonb, ${shares}::jsonb, ${actorId})`;
      await this.assertLimit(tx, product, id, scope.platformId);
      const platform =
        product === 'ofertas'
          ? await readMarginConfig(tx, 'plataformas', scope.platformId)
          : null;
      return this.present(tx, product, scope.platformId, next, platform);
    });
  }

  /** Margin shares of a sale never exceed 100% of the margin; a platform save rechecks its offers. */
  private async assertLimit(
    tx: Tx,
    product: AffiliateProduct,
    id: string,
    platformId: string,
  ) {
    const platform = await readMarginConfig(
      tx,
      'plataformas',
      product === 'plataformas' ? id : platformId,
    );
    const offers =
      product === 'ofertas'
        ? [id]
        : (
            await tx.$queryRaw<{ productId: string }[]>`
              SELECT a."productId" FROM "MarginAffiliateAgreement" a JOIN "Offer" o ON o.id = a."productId"
              JOIN "Platform" p ON p.tag = o."platformTag" WHERE a.product = 'ofertas' AND p.id = ${platformId}`
          ).map((row) => row.productId);
    const scopes = product === 'ofertas' ? offers : [null, ...offers];
    for (const offerId of scopes) {
      const offer = offerId
        ? await readMarginConfig(tx, 'ofertas', offerId)
        : null;
      const worst = marginWorstCaseBps(offer, platform);
      if (worst > 10000)
        throw new BadRequestException(
          `A soma de coprodutores e afiliados SimIntPay chegaria a ${percent(worst)}, ${percent(worst - 10000)} acima do limite de 100% da margem SimIntPay.`,
        );
    }
  }
}
