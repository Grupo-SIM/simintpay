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
import {
  emptyConfig,
  validateAffiliateInput,
  type AffiliateProduct,
} from './affiliate';
import { ensureAffiliateCode } from './affiliate-code';
import { platformIdOfOffer } from './affiliate-platform';
import { readMarginConfig } from './margin-affiliate-capture';
import type { MarginAffiliateConfig } from './margin-affiliate';

type Tx = Prisma.TransactionClient;
type Scope = { ownerId: string; platformId: string | null };

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
        (await readMarginConfig(tx, product, id)) ?? emptyConfig(product);
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
    const input = validateAffiliateInput(body, product);
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.authorize(tx, actorId, product, id);
      if (!scope.platformId)
        throw new BadRequestException(
          'Afiliados exigem uma oferta vinculada a uma plataforma ativa',
        );
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`margin-affiliate:${scope.platformId}`}, 0))::text`;
      const previous =
        (await readMarginConfig(tx, product, id)) ?? emptyConfig(product);
      if (previous.version !== input.version)
        throw new ConflictException(
          'Configuração alterada por outra sessão. Recarregue antes de salvar.',
        );
      const affiliates: MarginAffiliateConfig['affiliates'] = [];
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
      const next: MarginAffiliateConfig = {
        version: previous.version + 1,
        defaultPercentageBps: input.defaultPercentageBps,
        commissionOnRenewals: input.commissionOnRenewals,
        linkBaseUrl: null,
        affiliates,
      };
      for (const a of affiliates)
        await ensureAffiliateCode(tx, scope.platformId, a.userId);
      const list = JSON.stringify(affiliates);
      await tx.$executeRaw`INSERT INTO "MarginAffiliateAgreement" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", affiliates, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${list}::jsonb, ${actorId})
        ON CONFLICT (product, "productId") DO UPDATE SET version = EXCLUDED.version, "defaultPercentageBps" = EXCLUDED."defaultPercentageBps", "commissionOnRenewals" = EXCLUDED."commissionOnRenewals", affiliates = EXCLUDED.affiliates, "actorId" = EXCLUDED."actorId", "updatedAt" = now()`;
      await tx.$executeRaw`INSERT INTO "MarginAffiliateRevision" (product, "productId", version, "defaultPercentageBps", "commissionOnRenewals", affiliates, "actorId")
        VALUES (${product}, ${id}, ${next.version}, ${next.defaultPercentageBps}, ${next.commissionOnRenewals}, ${list}::jsonb, ${actorId})`;
      const platform =
        product === 'ofertas'
          ? await readMarginConfig(tx, 'plataformas', scope.platformId)
          : null;
      return this.present(tx, product, scope.platformId, next, platform);
    });
  }
}
