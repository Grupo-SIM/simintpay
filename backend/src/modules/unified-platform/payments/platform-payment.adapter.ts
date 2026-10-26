import { CORPORATE_PLATFORM_TAGS, unsupportedCapability } from '../../platform-core/platform-adapters';
import { Prisma } from '@prisma/client';
import { PLATFORM_TAXA_DEFAULTS } from '../../platform-taxas/platform-taxas.keys';

/** Business transformations only: gateways and persistence belong to the core. */
export class PlatformPaymentAdapter {
  constructor(readonly tag: string) {}

  description(value?: string): string {
    return value?.replace(/\[TENANT:[^\]]*\]/gi, '').trim() || 'Pagamento PIX';
  }

  fees(amount: Prisma.Decimal, rates: Record<string, number>, installments?: number) {
    const liquidity = new Prisma.Decimal(rates.LIQUIDEZ ?? PLATFORM_TAXA_DEFAULTS.LIQUIDEZ);
    const key = installments ? `MDR_CC_${installments}X` : 'MDR_PIX';
    const mdr = new Prisma.Decimal(rates[key] ?? PLATFORM_TAXA_DEFAULTS[key as keyof typeof PLATFORM_TAXA_DEFAULTS]);
    const netAmount = amount.mul(liquidity).toDecimalPlaces(2);
    const totalFee = amount.minus(netAmount);
    const domFee = amount.mul(mdr).toDecimalPlaces(2);
    return { netAmount, totalFee, domFee, platformFee: totalFee.minus(domFee) };
  }
}

class AtlasPaymentAdapter extends PlatformPaymentAdapter {
  override description(value?: string): string {
    return value?.replace(/\[TENANT:[^\]]*\]/gi, '').trim() || 'HOSTING Compra Atlas Hosting';
  }
}

const corporateAdapters: Record<string, typeof PlatformPaymentAdapter> = {
  ATLAS: AtlasPaymentAdapter,
  BOSQUE: PlatformPaymentAdapter,
  RENOVADA: PlatformPaymentAdapter,
  'ZERO-GRAU': PlatformPaymentAdapter,
};

export function resolvePaymentAdapter(tag: string): PlatformPaymentAdapter {
  if (CORPORATE_PLATFORM_TAGS.has(tag) && !corporateAdapters[tag]) unsupportedCapability('payments.corporate-contract');
  const Adapter = corporateAdapters[tag] ?? PlatformPaymentAdapter;
  return new Adapter(tag);
}
