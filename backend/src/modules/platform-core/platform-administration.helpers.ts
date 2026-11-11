import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { getRegisteredPlatform } from '../../modules/module.registry';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
export async function resolveConsolidadoPlatforms(
  prisma: PrismaService,
): Promise<ConsolidadoPlatformEntry[]> {
  const platforms = await prisma.platform.findMany({
    select: { tag: true, ownerUserId: true },
  });
  return platforms.map((platform) => ({
    tag: platform.tag,
    id: platform.ownerUserId,
  }));
}

export const FIXED_PLATFORM_TAGS = {
  has: (tag: string) => getRegisteredPlatform(tag) !== null,
};

export function parseYmdSp(s: string): dayjs.Dayjs {
  const t = s.trim();
  const strict = dayjs.tz(t, 'YYYY-MM-DD', TZ);
  return strict.isValid() ? strict : dayjs.tz(t, TZ);
}

export function normalizePlatformTag(tag: string): string {
  const upper = String(tag || '').toUpperCase();
  if (upper === 'EBOOKSIM' || upper === 'EBOOK') return 'EBOOK';
  if (upper === 'CONTROLE_MOTORISTA' || upper === 'CONTROLE-MOTORISTA')
    return 'CONTROLE-MOTORISTA';
  if (upper === 'CONTROLE_PATRIMONIAL' || upper === 'CONTROLE-PATRIMONIAL')
    return 'CONTROLE-PATRIMONIAL';
  return upper;
}

export const TZ = 'America/Sao_Paulo';

export function getTaxaServicoEffectiveDate(tag: string): Date {
  return tag === 'RENOVADA' || tag === 'BOSQUE'
    ? TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA
    : TAXA_SERVICO_EFFECTIVE_DATE;
}

export const TAGS_SEM_TAXA_SERVICO = new Set<string>([]);

export type ConsolidadoPlatformEntry = { tag: string; id: string };

export const TAXA_SERVICO_EFFECTIVE_DATE_RENOVADA = new Date(
  '2026-05-29T20:40:00.000Z',
);

export const TAXA_SERVICO_EFFECTIVE_DATE = new Date('2026-05-18T03:00:00.000Z');
