import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PLATFORM_TAXA_DEFAULTS,
  isEditablePlatformTaxaKey,
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
/** Maior taxa de saque (R$) entre as adquirentes ativas, vinda da última revisão de cada uma. */
let acquirerWithdrawalMax = 0;
/** Custo sincronizado por faixa `METHOD/CHANNEL/N`: o maior entre as adquirentes ativas. */
type SyncedAcquirerFee = {
  fixedCents: number;
  ratePpm: number;
  interestPpm: number;
  base: string;
};
let acquirerFeeCache = new Map<string, SyncedAcquirerFee>();
let lastCacheUpdate = 0;
const CACHE_TTL = 30 * 1000;
let isFetching = false;

async function loadAcquirerWithdrawalMax(): Promise<number> {
  const client = getPrisma();
  const active =
    (await client.acquirerCatalogue?.findMany({
      where: { active: true },
      select: { code: true },
    })) ?? [];
  if (!active.length) return 0;
  const rows =
    (await client.acquirerWithdrawalFee?.findMany({
      where: { acquirerCode: { in: active.map((a) => a.code) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) ?? [];
  const latest = new Map<string, number>();
  for (const row of rows)
    if (!latest.has(row.acquirerCode))
      latest.set(row.acquirerCode, row.feeCents);
  return Math.max(0, ...latest.values()) / 100;
}

async function loadAcquirerFees(): Promise<Map<string, SyncedAcquirerFee>> {
  const client = getPrisma();
  const active =
    (await client.acquirerCatalogue?.findMany({
      where: { active: true },
      select: { code: true },
    })) ?? [];
  const result = new Map<string, SyncedAcquirerFee>();
  if (!active.length) return result;
  const rows =
    (await client.acquirerFeeSchedule?.findMany({
      where: { acquirerCode: { in: active.map((a) => a.code) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })) ?? [];
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.acquirerCode}/${row.method}/${row.channel}/${row.installments}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  for (const row of latest.values()) {
    const key = `${row.method}/${row.channel}/${row.installments}`;
    const current = result.get(key);
    if (
      !current ||
      row.ratePpm + row.interestPpm > current.ratePpm + current.interestPpm
    )
      result.set(key, {
        fixedCents:
          row.fixedCents + domCashbackFixedCents(row.acquirerCode, row.channel),
        ratePpm: row.ratePpm,
        interestPpm: row.interestPpm,
        base: row.base,
      });
  }
  return result;
}

/**
 * Custo (R$) da adquirente para a faixa, lido só da tabela sincronizada.
 * Sem linha sincronizada devolve 0 (custo desconhecido, nunca um valor presumido).
 */
export function syncedAcquirerCostReais(
  method: 'PIX' | 'BOLETO' | 'DEBIT_CARD' | 'CREDIT_CARD',
  channel: 'ONLINE' | 'POS',
  installments: number,
  amountReais: number,
): { pct: number; fixa: number; total: number } {
  readOverridesRaw();
  const fee = acquirerFeeCache.get(`${method}/${channel}/${installments}`);
  if (!fee) return { pct: 0, fixa: 0, total: 0 };
  const pct = (amountReais * (fee.ratePpm + fee.interestPpm)) / 1_000_000;
  const fixa = fee.fixedCents / 100;
  return { pct, fixa, total: pct + fixa };
}

export async function initializePlatformTaxasCache(
  client?: PrismaClient,
): Promise<void> {
  if (client) prisma = client;
  try {
    const records = await getPrisma().platformTaxaOverride.findMany();
    const newCache: Overrides = {};
    for (const req of records) {
      if (!isEditablePlatformTaxaKey(req.key) || isClientTaxaTag(req.tag))
        continue;
      if (!newCache[req.tag]) {
        newCache[req.tag] = {};
      }
      newCache[req.tag][req.key] = req.value;
    }

    acquirerWithdrawalMax = await loadAcquirerWithdrawalMax();
    acquirerFeeCache = await loadAcquirerFees();
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

/** Taxa cobrada no saque: maior custo ativo da adquirente mais o extra configurado. */
export function resolveWithdrawalFixedFee(tag: string): number {
  readOverridesRaw();
  return (
    Math.round(
      (acquirerWithdrawalMax +
        getPlatformTaxaEffective(
          tag,
          'TAXA_SAQUE_EXTRA',
          PLATFORM_TAXA_DEFAULTS.TAXA_SAQUE_EXTRA,
        )) *
        100,
    ) / 100
  );
}

export function getPlatformTaxaEffective(
  listOrModuleTag: string,
  keySuffix: string,
  fallback: number,
): number {
  // Legacy constants support historical projections only; no legacy override is applied.
  if (!isEditablePlatformTaxaKey(keySuffix))
    return PLATFORM_TAXA_DEFAULTS[keySuffix as PlataformaTaxaKey] ?? fallback;
  if (isClientTaxaTag(listOrModuleTag))
    return getPlatformTaxaEffective('GLOBAL', keySuffix, fallback);

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

/** Cashback DOM é uma configuração global manual: desligado, não é cobrado nem gerado. */
export function isDomCashbackActive(): boolean {
  return (
    getPlatformTaxaEffective(
      'GLOBAL',
      'CASHBACK_DOM_ATIVO',
      PLATFORM_TAXA_DEFAULTS.CASHBACK_DOM_ATIVO,
    ) !== 0
  );
}

/** Custo fixo (R$) do cashback DOM por transação online; 0 quando desativado. */
export function domCashbackReais(): number {
  return isDomCashbackActive()
    ? getPlatformTaxaEffective(
        'GLOBAL',
        'CASHBACK_DOM_CUSTO',
        PLATFORM_TAXA_DEFAULTS.CASHBACK_DOM_CUSTO,
      )
    : 0;
}

/**
 * Cashback DOM entra no preço apenas nas tabelas online da DOM. Em outras adquirentes o custo
 * (cashback avulso) é da SimIntPay e aparece só nos relatórios como taxa de cashback DOM.
 */
export function domCashbackFixedCents(acquirer: string, channel: string) {
  return acquirer === 'DOM' && channel === 'ONLINE' ? domCashbackCents() : 0;
}

/** Bônus em centavos concedido ao comprador de outra adquirente; 0 quando desativado. */
export function domCashbackGrantCents(): number {
  return isDomCashbackActive()
    ? Math.round(
        getPlatformTaxaEffective(
          'GLOBAL',
          'CASHBACK_DOM_VALOR',
          PLATFORM_TAXA_DEFAULTS.CASHBACK_DOM_VALOR,
        ) * 100,
      )
    : 0;
}

export function domCashbackCents(): number {
  return Math.round(domCashbackReais() * 100);
}

export function getPlatformTaxaSource(
  listOrModuleTag: string,
  keySuffix: string,
): 'override' | 'global' | 'default' {
  if (!isEditablePlatformTaxaKey(keySuffix)) return 'default';
  if (isClientTaxaTag(listOrModuleTag))
    return getPlatformTaxaSource('GLOBAL', keySuffix);

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

export function defaultTaxaValue(key: PlataformaTaxaKey): number {
  return PLATFORM_TAXA_DEFAULTS[key];
}

/** Força recarga do cache na próxima leitura (use após deletar overrides direto no banco). */
export function invalidatePlatformTaxaCache(): void {
  lastCacheUpdate = 0;
}

/** Update only requested keys, preserving concurrent changes to other platforms. */
export async function patchPlatformOverrides(
  tag: string,
  patch: Record<string, number | null>,
): Promise<void> {
  const canonical = canonicalPlatformTaxaTag(tag);
  if (isClientTaxaTag(canonical))
    throw new Error('Configure taxas por plataforma em /admin/taxas');
  if (Object.keys(patch).some((key) => !isEditablePlatformTaxaKey(key)))
    throw new Error(
      'Taxa legada: configure a política financeira em /admin/taxas',
    );
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
