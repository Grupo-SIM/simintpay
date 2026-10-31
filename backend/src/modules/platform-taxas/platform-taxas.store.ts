import { getRegisteredPlatform } from '../module.registry';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PLATFORM_TAXA_DEFAULTS,
  PLATAFORMA_TAXA_KEYS,
  type PlataformaTaxaKey,
} from './platform-taxas.keys';

type Overrides = Record<string, Record<string, number>>;

let prisma: PrismaClient;

function getPrisma(): PrismaClient {
  if (!prisma) {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      const adapter = new PrismaPg({ connectionString });
      prisma = new PrismaClient({ adapter });
    } else {
      prisma = new PrismaClient();
    }
  }
  return prisma;
}

let overridesCache: Overrides = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 1000;
let isFetching = false;

export async function initializePlatformTaxasCache(
  client?: PrismaClient,
): Promise<void> {
  if (client) prisma = client;
  try {
    const records = await getPrisma().platformTaxaOverride.findMany();
    const newCache: Overrides = {};
    for (const req of records) {
      if (!newCache[req.tag]) {
        newCache[req.tag] = {};
      }
      newCache[req.tag][req.key] = req.value;
    }

    // Legacy aliases only for registered accounts; never infer ownership from an arbitrary email.
    const users = await getPrisma().user?.findMany({
      select: { id: true, email: true },
    });
    legacyUserTags.clear();
    for (const user of users ?? [])
      legacyUserTags.set(
        buildUserTaxaTag(user.id),
        buildClientTaxaTag(user.email),
      );
    overridesCache = newCache;
    lastCacheUpdate = Date.now();
  } catch (err: unknown) {
    console.error('Failed to initialize platform taxa overrides from DB', err);
  }
}

function refreshCacheAsync(): void {
  if (isFetching) return;
  isFetching = true;
  initializePlatformTaxasCache().finally(() => {
    isFetching = false;
  });
}

export function canonicalPlatformTaxaTag(tag: string): string {
  const u = String(tag || '').toUpperCase();
  if (u === 'EBOOKSIM') return 'EBOOK';
  return u;
}

/** Prefixo de tag para taxa personalizada por cliente (e-mail) na SIM INT PAY (GLOBAL). */
export const CLIENT_TAXA_TAG_PREFIX = 'CLIENT:';
export function buildUserTaxaTag(id: string): string {
  return `USER:${id.toUpperCase()}`;
}
const legacyUserTags = new Map<string, string>();

/** Monta a tag canônica de um cliente personalizado a partir do e-mail (ex.: CLIENT:JOAO@X.COM). */
export function buildClientTaxaTag(email: string): string {
  return `${CLIENT_TAXA_TAG_PREFIX}${String(email || '')
    .trim()
    .toUpperCase()}`;
}

/** True se a tag representa um cliente personalizado (CLIENT:<email>). */
export function isClientTaxaTag(tag: string): boolean {
  return /^(CLIENT:|USER:)/.test(String(tag || '').toUpperCase());
}

export function readOverridesRaw(): Overrides {
  const now = Date.now();
  if (now - lastCacheUpdate > CACHE_TTL) {
    refreshCacheAsync();
  }
  return overridesCache;
}

/** Antigo padrão DOM PIX 0,98% (decimal 0,0098). Overrides/env antigos: mapear para `MDR_PIX` atual das keys. */
const LEGACY_MDR_PIX_098 = 0.0098;

function finalizeResolvedTaxa(keySuffix: string, value: number): number {
  if (keySuffix !== 'MDR_PIX') return value;
  if (!Number.isFinite(value)) return PLATFORM_TAXA_DEFAULTS.MDR_PIX;
  if (Math.abs(value - LEGACY_MDR_PIX_098) < 1e-9) {
    return PLATFORM_TAXA_DEFAULTS.MDR_PIX;
  }
  return value;
}

export function getPlatformTaxaEffective(
  listOrModuleTag: string,
  keySuffix: string,
  fallback: number,
): number {
  // Cliente personalizado (SIM INT PAY): usa o override do cliente; se não houver
  // para esta chave, herda TODA a resolução do GLOBAL (override + default).
  if (isClientTaxaTag(listOrModuleTag)) {
    const clientTag = canonicalPlatformTaxaTag(listOrModuleTag);
    const clientOverride = readOverridesRaw()[clientTag]?.[keySuffix];
    if (
      clientOverride !== undefined &&
      Number.isFinite(Number(clientOverride))
    ) {
      return finalizeResolvedTaxa(keySuffix, Number(clientOverride));
    }
    const legacyTag = legacyUserTags.get(clientTag);
    const legacyOverride = legacyTag
      ? readOverridesRaw()[legacyTag]?.[keySuffix]
      : undefined;
    if (legacyOverride !== undefined && Number.isFinite(Number(legacyOverride)))
      return finalizeResolvedTaxa(keySuffix, Number(legacyOverride));
    return getPlatformTaxaEffective('GLOBAL', keySuffix, fallback);
  }

  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const overrides = readOverridesRaw();

  // 1º: override específico da plataforma
  const platformRow = overrides[canonical];
  const platformOverride = platformRow?.[keySuffix];
  if (
    platformOverride !== undefined &&
    Number.isFinite(Number(platformOverride))
  ) {
    return finalizeResolvedTaxa(keySuffix, Number(platformOverride));
  }

  // 2º: override global (tag GLOBAL)
  if (canonical !== 'GLOBAL') {
    const ownerId = getRegisteredPlatform(canonical)?.ownerUserId;
    if (ownerId) {
      const ownerTag = buildUserTaxaTag(ownerId);
      const legacy = legacyUserTags.get(ownerTag);
      const ownerValue =
        overrides[ownerTag]?.[keySuffix] ??
        (legacy ? overrides[legacy]?.[keySuffix] : undefined);
      if (ownerValue !== undefined && Number.isFinite(Number(ownerValue)))
        return finalizeResolvedTaxa(keySuffix, Number(ownerValue));
    }
    const globalRow = overrides['GLOBAL'];
    const globalOverride = globalRow?.[keySuffix];
    if (
      globalOverride !== undefined &&
      Number.isFinite(Number(globalOverride))
    ) {
      return finalizeResolvedTaxa(keySuffix, Number(globalOverride));
    }
  }

  // 3º: padrão único para todos os consumidores.
  return finalizeResolvedTaxa(
    keySuffix,
    PLATFORM_TAXA_DEFAULTS[keySuffix as PlataformaTaxaKey] ?? fallback,
  );
}

export function getPlatformTaxaSource(
  listOrModuleTag: string,
  keySuffix: string,
): 'override' | 'global' | 'default' {
  // Cliente personalizado: 'override' se ele tem valor próprio; senão, a fonte é o GLOBAL.
  if (isClientTaxaTag(listOrModuleTag)) {
    const clientTag = canonicalPlatformTaxaTag(listOrModuleTag);
    const clientRow = readOverridesRaw()[clientTag];
    if (
      clientRow &&
      Object.prototype.hasOwnProperty.call(clientRow, keySuffix)
    ) {
      return 'override';
    }
    const legacyTag = legacyUserTags.get(clientTag);
    if (
      legacyTag &&
      Object.prototype.hasOwnProperty.call(
        readOverridesRaw()[legacyTag] ?? {},
        keySuffix,
      )
    )
      return 'override';
    return getPlatformTaxaSource('GLOBAL', keySuffix);
  }

  const canonical = canonicalPlatformTaxaTag(listOrModuleTag);
  const overrides = readOverridesRaw();

  const platformRow = overrides[canonical];
  if (
    platformRow &&
    Object.prototype.hasOwnProperty.call(platformRow, keySuffix)
  ) {
    return 'override';
  }

  if (canonical !== 'GLOBAL') {
    const ownerId = getRegisteredPlatform(canonical)?.ownerUserId;
    const ownerTag = ownerId ? buildUserTaxaTag(ownerId) : null;
    const legacy = ownerTag ? legacyUserTags.get(ownerTag) : null;
    if (
      (ownerTag &&
        Object.prototype.hasOwnProperty.call(
          overrides[ownerTag] ?? {},
          keySuffix,
        )) ||
      (legacy &&
        Object.prototype.hasOwnProperty.call(
          overrides[legacy] ?? {},
          keySuffix,
        ))
    )
      return 'override';
    const globalRow = overrides['GLOBAL'];
    if (
      globalRow &&
      Object.prototype.hasOwnProperty.call(globalRow, keySuffix)
    ) {
      return 'global';
    }
  }

  return 'default';
}

function isAllowedKey(k: string): k is PlataformaTaxaKey {
  return (PLATAFORMA_TAXA_KEYS as readonly string[]).includes(k);
}

export function applyPatchToOverrides(
  tagParam: string,
  patch: Record<string, number | null>,
): Overrides {
  const canonical = canonicalPlatformTaxaTag(tagParam);
  const all: Overrides = { ...readOverridesRaw() };
  const prev = { ...(all[canonical] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (!isAllowedKey(k)) continue;
    if (v === null) {
      delete prev[k];
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Valor inválido para ${k}`);
    }
    prev[k] = v;
  }
  all[canonical] = prev;
  return all;
}

export async function writeOverrides(data: Overrides): Promise<void> {
  const newItems: { tag: string; key: string; value: number }[] = [];
  for (const [tag, keys] of Object.entries(data)) {
    for (const [key, value] of Object.entries(keys)) {
      newItems.push({ tag, key, value });
    }
  }

  // Persiste no banco antes de atualizar o cache: se falhar, lança erro para o chamador
  await getPrisma().$transaction([
    getPrisma().platformTaxaOverride.deleteMany(),
    getPrisma().platformTaxaOverride.createMany({ data: newItems }),
  ]);

  overridesCache = JSON.parse(JSON.stringify(data));
  lastCacheUpdate = Date.now();
}

export function defaultTaxaValue(key: PlataformaTaxaKey): number {
  return PLATFORM_TAXA_DEFAULTS[key];
}

/** Força recarga do cache na próxima leitura (use após deletar overrides direto no banco). */
export function invalidatePlatformTaxaCache(): void {
  lastCacheUpdate = 0;
}

/** Customer interest belongs to the platform, independently of admin cost overrides. */
export function getCustomerInterestRate(
  tag: string,
  installments: number,
): number {
  readOverridesRaw();
  const n = Math.min(12, Math.max(1, Math.trunc(installments)));
  const canonical = canonicalPlatformTaxaTag(tag);
  const platform = getRegisteredPlatform(canonical);
  if (platform?.absorbCustomerInterest) return 0;
  const configured = (
    platform?.customerInterestRates as Record<string, number> | undefined
  )?.[String(n)];
  return typeof configured === 'number' && Number.isFinite(configured)
    ? configured
    : getPlatformTaxaEffective(
        'GLOBAL',
        `MDR_LINK_${n}X`,
        PLATFORM_TAXA_DEFAULTS[`MDR_LINK_${n}X` as PlataformaTaxaKey],
      );
}

/** Update only requested keys, preserving concurrent changes to other platforms. */
export async function patchPlatformOverrides(
  tag: string,
  patch: Record<string, number | null>,
): Promise<void> {
  const canonical = canonicalPlatformTaxaTag(tag);
  const operations = Object.entries(patch).map(([key, value]) =>
    value === null
      ? getPrisma().platformTaxaOverride.deleteMany({
          where: { tag: canonical, key },
        })
      : getPrisma().platformTaxaOverride.upsert({
          where: { tag_key: { tag: canonical, key } },
          create: { tag: canonical, key, value },
          update: { value },
        }),
  );
  await getPrisma().$transaction(operations);
  await initializePlatformTaxasCache();
}
