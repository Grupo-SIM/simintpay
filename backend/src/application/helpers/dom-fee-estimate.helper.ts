import { getPlatformTaxaEffective, canonicalPlatformTaxaTag } from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';
import { isMaquinetaDescription } from '../utils/internal-tags.util';

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

/**
 * Débito em venda física.
 *
 * A DOM manda `payment_method: "credit_card"` também nas vendas no DÉBITO feitas
 * pela maquineta — o que distingue é a bandeira (`card_brand`): "VISA DEBITO",
 * "ELO DEBITO", "MAESTRO", "VISA ELECTRON". Sem olhar a bandeira, toda venda no
 * débito seria cobrada pela taxa de crédito.
 */
export function isPhysicalDebit(
  paymentMethodRaw: string | null | undefined,
  cardBrandRaw?: string | null,
): boolean {
  const pm = String(paymentMethodRaw ?? '').toLowerCase();
  if (pm.includes('debit')) return true;
  const brand = String(cardBrandRaw ?? '').toUpperCase();
  return (
    brand.includes('DEBITO') ||
    brand.includes('DÉBITO') ||
    brand.includes('DEBIT') ||
    brand.includes('MAESTRO') ||
    brand.includes('ELECTRON')
  );
}

/** true quando a transação é venda física (maquineta / POS). */
export function isPhysicalSale(input: { isPhysical?: boolean | null; description?: string | null }): boolean {
  if (input.isPhysical !== undefined && input.isPhysical !== null) return Boolean(input.isPhysical);
  return isMaquinetaDescription(input.description);
}

/**
 * Custo DOM em venda FÍSICA (maquineta / POS) — tabela oficial, diferente da online.
 * PIX 1% sem fixa; débito e crédito somam POS_TAXA_DOM_FIXA (R$1) por transação.
 * Não há cobrança de cashback em POS (o cliente não registra os dados do bônus).
 */
export function estimatePhysicalDomFeeReais(input: {
  amountReais: number;
  paymentMethod?: string | null;
  installments?: number | null;
  tenantTag?: string;
  /** Bandeira do cartão — única forma de distinguir débito de crédito no POS. */
  cardBrand?: string | null;
}): { pct: number; fixa: number; total: number } {
  const amount = Number(input.amountReais) || 0;
  const tag = (input.tenantTag ?? 'GLOBAL').toUpperCase();
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const inst = Math.min(Math.max(Number(input.installments ?? 1) || 1, 1), 12);
  const taxa = (key: string) =>
    getPlatformTaxaEffective(tag, key, (PLATFORM_TAXA_DEFAULTS as Record<string, number>)[key] ?? 0);

  // PIX físico: só percentual, sem taxa fixa.
  if (!pm.includes('card') && !pm.includes('credit') && !pm.includes('debit')) {
    const pct = round4(amount * taxa('POS_MDR_PIX'));
    return { pct, fixa: 0, total: pct };
  }

  const rateKey = isPhysicalDebit(input.paymentMethod, input.cardBrand)
    ? 'POS_MDR_DEBITO'
    : `POS_MDR_CC_${inst}X`;
  const pct = round2(amount * taxa(rateKey));
  const fixa = round2(taxa('POS_TAXA_DOM_FIXA'));
  return { pct, fixa, total: round2(pct + fixa) };
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
  /** Venda física (maquineta/POS): usa a tabela POS_* em vez da tabela online. */
  isPhysical?: boolean | null;
  /** Descrição da transação — se não vier `isPhysical`, detecta POS por ela. */
  description?: string | null;
  /** Bandeira do cartão — no POS é o que distingue débito de crédito. */
  cardBrand?: string | null;
}): number {
  const amount = Number(input.amountReais) || 0;
  const tag = (input.tenantTag ?? 'GLOBAL').toUpperCase();
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const inst = Math.min(Math.max(Number(input.installments ?? 1) || 1, 1), 12);

  // Venda física (maquineta/POS): tabela própria — taxas diferentes da online.
  if (isPhysicalSale(input)) {
    return estimatePhysicalDomFeeReais({
      amountReais: amount,
      paymentMethod: input.paymentMethod,
      installments: inst,
      tenantTag: tag,
      cardBrand: input.cardBrand,
    }).total;
  }

  if (pm.includes('boleto')) {
    // Boleto: custo DOM fixo por boleto pago = TAXA_BOLETO_DOM + TAXA_BOLETO_DOM_FIXA (padrão 3,49 + 1,00).
    const domFixa = getPlatformTaxaEffective(tag, 'TAXA_BOLETO_DOM', PLATFORM_TAXA_DEFAULTS.TAXA_BOLETO_DOM);
    const domTransacao = getPlatformTaxaEffective(tag, 'TAXA_BOLETO_DOM_FIXA', PLATFORM_TAXA_DEFAULTS.TAXA_BOLETO_DOM_FIXA);
    return round2(domFixa + domTransacao);
  }
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
  isPhysical?: boolean | null;
  description?: string | null;
  cardBrand?: string | null;
}): number {
  const amount = Number(input.amountReais) || 0;
  const fromApi = Number(input.mdrFromGateway ?? input.domFeeFromGateway ?? 0);
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const isPixLike = !pm.includes('debit') && !pm.includes('card') && !pm.includes('credit');
  const estimate = () => estimateDomFeeReais({
    amountReais: input.amountReais,
    paymentMethod: input.paymentMethod,
    installments: input.installments,
    tenantTag: input.tenantTag,
    isPhysical: input.isPhysical,
    description: input.description,
    cardBrand: input.cardBrand,
  });

  if (Number.isFinite(fromApi) && fromApi > 0) {
    if (isPixLike && amount > 0 && !isPhysicalSale(input)) {
      const impliedRate = fromApi / amount;
      if (Math.abs(impliedRate - LEGACY_DOM_PIX_RATE) < 0.00015) {
        return estimate();
      }
    }
    return round4(fromApi);
  }
  return estimate();
}
