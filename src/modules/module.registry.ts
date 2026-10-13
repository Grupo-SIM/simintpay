import type { PrismaClient, Prisma } from '@prisma/client';
import type { ModuleConfig } from './module-config.interface';
import { Acquirer, toAcquirer } from '../core/services/acquirer.enum';
import { canonicalPlatformTaxaTag, getPlatformTaxaEffective } from './platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from './platform-taxas/platform-taxas.keys';
import { cartaoMdrProxy } from './platform-taxas/cartao-mdr-proxy';
import { getPlatformIntegrationValue } from './platform-integrations/platform-integrations.store';

export type RegisteredPlatform = {
  id: string;
  tag: string;
  name: string;
  ownerUserId: string;
  tenantModuleId: string | null;
  acquirer: string;
  customerInterestRates: Prisma.JsonValue;
  absorbCustomerInterest: boolean;
};
let platforms = new Map<string, RegisteredPlatform>();
let client: PrismaClient | undefined;
let fetchedAt = 0;
let refreshing: Promise<void> | undefined;

export async function initializePlatformRegistryCache(prisma: PrismaClient): Promise<void> {
  client = prisma;
  const rows = await prisma.platform.findMany({
    where: { isActive: true, owner: { isActive: true, isPurged: false } },
    select: { id: true, tag: true, name: true, ownerUserId: true, tenantModuleId: true, acquirer: true, customerInterestRates: true, absorbCustomerInterest: true },
  });
  platforms = new Map(rows.map((row) => [row.tag, row]));
  fetchedAt = Date.now();
}

export function getRegisteredPlatform(tag: string | null | undefined): RegisteredPlatform | null {
  if (!tag) return null;
  if (client && Date.now() - fetchedAt > 30_000 && !refreshing) {
    refreshing = initializePlatformRegistryCache(client).catch(() => { platforms.clear(); }).finally(() => { refreshing = undefined; });
  }
  if (Date.now() - fetchedAt > 60_000) return null;
  return platforms.get(canonicalPlatformTaxaTag(tag.replace(/_/g, '-'))) ?? null;
}
export function registeredPlatformTags(): string[] { return [...platforms.keys()]; }
export function getPlatformOwnerId(tag: string | null | undefined): string | null {
  return getRegisteredPlatform(tag)?.ownerUserId ?? null;
}
export function setCustomerInterestRates(tag: string, rates: Record<string, number>): void {
  const platform = getRegisteredPlatform(tag);
  if (platform) platforms.set(platform.tag, { ...platform, customerInterestRates: rates });
}

export function getModuleConfig(slug: string | null | undefined): ModuleConfig | null {
  const platform = getRegisteredPlatform(slug);
  if (!platform) return null;
  const effective = (key: keyof typeof PLATFORM_TAXA_DEFAULTS) => getPlatformTaxaEffective(platform.tag, key, PLATFORM_TAXA_DEFAULTS[key]);
  return {
    name: platform.name, slug: platform.tag.toLowerCase(),
    saque: {
      get minValor() { return effective('SAQUE_MIN'); },
      get taxaFixa() { return effective('TAXA_SAQUE_FIXA'); },
      get taxaPercentual() { return effective('TAXA_SAQUE_PERCENT'); },
      get fatorLiquidez() { return effective('LIQUIDEZ'); },
      calcularTaxa(valorBruto: number) { return this.taxaFixa + valorBruto * this.taxaPercentual; },
      calcularLiquido(valorBruto: number) { return valorBruto - this.calcularTaxa(valorBruto); },
    },
    mdr: {
      get pix() { return effective('MDR_PIX'); },
      cartao: cartaoMdrProxy(platform.tag),
      get taxaFixaPorTransacao() { return effective('TAXA_FIXA_TRANSACAO'); },
      get taxaCashback() { return effective('TAXA_CASHBACK'); },
    },
    limites: { saldoMaximo: null, saqueMaximo: null, saquesPendentesMax: 1 },
  };
}
export function getModuleDomToken(slug: string | null | undefined): string | null {
  const platform = getRegisteredPlatform(slug);
  return platform ? getPlatformIntegrationValue(platform.tag, 'DOM_TOKEN') : null;
}
export function getModuleAcquirer(slug: string | null | undefined): Acquirer {
  return toAcquirer(getRegisteredPlatform(slug)?.acquirer);
}
export const MODULE_REGISTRY = new Proxy({} as Record<string, ModuleConfig>, {
  ownKeys: () => registeredPlatformTags().map((tag) => tag.toLowerCase()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  get: (_target, slug: string) => getModuleConfig(slug),
});
export type { ModuleConfig };
