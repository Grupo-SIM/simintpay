import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { getRegisteredPlatform } from '../../modules/module.registry';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(utc); dayjs.extend(timezone); dayjs.extend(customParseFormat);
export async function resolveConsolidadoPlatforms(
  prisma: PrismaService,
): Promise<ConsolidadoPlatformEntry[]> {
  const platforms = await prisma.platform.findMany({
    where: { isActive: true },
    select: { tag: true, ownerUserId: true },
  });
  return platforms.map((platform) => ({ tag: platform.tag, id: platform.ownerUserId }));
}

export async function getComunidadeOrderRows(
  prisma: PrismaService,
  dataInicio?: string,
  dataFim?: string,
  metodoPagamento?: string,
): Promise<Array<{ id: string; userId: string; amount: unknown; netAmount: unknown; createdAt: Date; description: string; installments: number; paymentMethod: string | null }>> {
  const bindings = await prisma.communityLinkBinding.findMany({
    where: { subscriptionLinkId: { not: null } },
    select: {
      subscriptionLinkId: true,
      community: { select: { slug: true } },
    },
    distinct: ['subscriptionLinkId'],
  });
  // Map linkId → community slug (uppercased) for per-community tagging
  const linkIdToTag = new Map(
    bindings.map((b) => [b.subscriptionLinkId!, b.community.slug.toUpperCase()])
  );
  const linkIds = [...linkIdToTag.keys()].filter(Boolean);
  if (linkIds.length === 0) return [];

  const createdAt: Prisma.DateTimeFilter = {};
  if (dataInicio) {
    const d = dayjs.tz(dataInicio, TZ).startOf('day');
    if (d.isValid()) createdAt.gte = d.toDate();
  }
  if (dataFim) {
    const d = dayjs.tz(dataFim, TZ).endOf('day');
    if (d.isValid()) createdAt.lte = d.toDate();
  }

  const orders = await prisma.subscriptionLinkOrder.findMany({
    where: {
      subscriptionLinkId: { in: linkIds },
      status: 'paid',
      ...(metodoPagamento ? { paymentMethod: metodoPagamento as any } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    },
    select: {
      id: true,
      amountCharged: true,
      platformFeeAmount: true,
      createdAt: true,
      paymentMethod: true,
      subscriptionLinkId: true,
      subscriptionLink: { select: { userId: true, name: true } },
    },
  });

  return orders.flatMap((o) => {
    const tag = linkIdToTag.get(o.subscriptionLinkId ?? '');
    if (!tag) return [];
    return [{
      id: `comunidade_order_${o.id}`,
      userId: o.subscriptionLink.userId,
      amount: o.amountCharged,
      netAmount: Number(o.amountCharged) - Number(o.platformFeeAmount),
      createdAt: o.createdAt,
      description: `${o.subscriptionLink.name} [TENANT:${tag}]`,
      installments: 1,
      paymentMethod: o.paymentMethod ?? null,
    }];
  });
}

export const FIXED_PLATFORM_TAGS = { has: (tag: string) => getRegisteredPlatform(tag) !== null };

export function parseYmdSp(s: string): dayjs.Dayjs {
  const t = s.trim();
  const strict = dayjs.tz(t, 'YYYY-MM-DD', TZ);
  return strict.isValid() ? strict : dayjs.tz(t, TZ);
}

export function normalizePlatformTag(tag: string): string {
  const upper = String(tag || '').toUpperCase();
  if (upper === 'EBOOKSIM' || upper === 'EBOOK') return 'EBOOK';
  if (upper === 'CONTROLE_MOTORISTA' || upper === 'CONTROLE-MOTORISTA') return 'CONTROLE-MOTORISTA';
  if (upper === 'CONTROLE_PATRIMONIAL' || upper === 'CONTROLE-PATRIMONIAL') return 'CONTROLE-PATRIMONIAL';
  return upper;
}

export const TZ = 'America/Sao_Paulo';

export function getTaxaServicoEffectiveDate(tag: string): Date {
  return tag === 'RENOVADA' || tag === 'BOSQUE' ? TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA : TAXA_SERVICO_EFFECTIVE_DATE;
}

export const TAGS_SEM_TAXA_SERVICO = new Set<string>([]);

export type ConsolidadoPlatformEntry = { tag: string; id: string };

export const TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA = new Date('2026-05-29T20:40:00.000Z');

export const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');
