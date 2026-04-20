import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

/** Extrai `[TENANT:FOO]` da descrição/produto para taxas efetivas (MDR PIX etc.). */
export function platformTaxaTagFromText(text: string | null | undefined): string {
  const m = String(text ?? '').match(/\[TENANT:([^\]]+)\]/i);
  return m ? canonicalPlatformTaxaTag(m[1].trim()) : 'GLOBAL';
}

/** Taxa DOM cartão crédito por parcelas (mesmo padrão do checkout / api-dom.client). */
const DOM_CC_RATE_BY_INSTALLMENT: Record<number, number> = {
  1: 0.0399,
  2: 0.083,
  3: 0.0968,
  4: 0.1104,
  5: 0.1237,
  6: 0.1367,
  7: 0.1495,
  8: 0.1621,
  9: 0.1744,
  10: 0.1864,
  11: 0.1983,
  12: 0.2099,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Precisão para MDR % sobre valores baixos (ex.: 0,98% de R$ 1,00 = R$ 0,0098). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Estima taxa DOM quando a listagem não traz mdr_value/dom_fee (comum no GET /transactions).
 * PIX: MDR_PIX (decimal sobre o valor pago; padrão 2% = 0,02). Débito: 3,49% + R$1. Crédito: tabela por parcela + R$1 em 2x+.
 */
export function estimateDomFeeReais(input: {
  amountReais: number;
  paymentMethod?: string | null;
  installments?: number | null;
  tenantTag?: string;
}): number {
  const amount = Number(input.amountReais) || 0;
  const tag = (input.tenantTag ?? 'GLOBAL').toUpperCase();
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const inst = Math.min(Math.max(Number(input.installments ?? 1) || 1, 1), 12);

  if (pm.includes('debit')) {
    return round2(amount * 0.0349 + 1.0);
  }
  if (pm.includes('card') || pm.includes('credit')) {
    const rate = DOM_CC_RATE_BY_INSTALLMENT[inst] ?? DOM_CC_RATE_BY_INSTALLMENT[1];
    const fixed = inst > 1 ? 1.0 : 0;
    return round2(amount * rate + fixed);
  }
  const mdrPix = getPlatformTaxaEffective(tag, 'MDR_PIX', PLATFORM_TAXA_DEFAULTS.MDR_PIX);
  return round4(amount * mdrPix);
}

/** Taxa implícita antiga 0,98% no valor gravado pela DOM / Prisma — recalcular com MDR_PIX atual. */
const LEGACY_DOM_PIX_RATE = 0.0098;

export function resolveDomFeeReais(input: {
  amountReais: number;
  paymentMethod?: string | null;
  installments?: number | null;
  mdrFromGateway?: number | null;
  domFeeFromGateway?: number | null;
  tenantTag?: string;
}): number {
  const amount = Number(input.amountReais) || 0;
  const fromApi = Number(input.mdrFromGateway ?? input.domFeeFromGateway ?? 0);
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const isPixLike = !pm.includes('debit') && !pm.includes('card') && !pm.includes('credit');

  if (Number.isFinite(fromApi) && fromApi > 0) {
    if (isPixLike && amount > 0) {
      const impliedRate = fromApi / amount;
      if (Math.abs(impliedRate - LEGACY_DOM_PIX_RATE) < 0.00015) {
        return estimateDomFeeReais({
          amountReais: input.amountReais,
          paymentMethod: input.paymentMethod,
          installments: input.installments,
          tenantTag: input.tenantTag,
        });
      }
    }
    return round4(fromApi);
  }
  return estimateDomFeeReais({
    amountReais: input.amountReais,
    paymentMethod: input.paymentMethod,
    installments: input.installments,
    tenantTag: input.tenantTag,
  });
}
