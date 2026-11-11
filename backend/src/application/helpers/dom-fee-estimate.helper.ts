import { transactionPlatformTag } from '../../modules/platform-core/transaction-platform';
import {
  canonicalPlatformTaxaTag,
  syncedAcquirerCostReais,
} from '../../modules/platform-taxas/platform-taxas.store';
import { isMaquinetaDescription } from '../utils/internal-tags.util';

/** Extrai `[TENANT:FOO]` da descrição/produto para taxas efetivas (MDR PIX etc.). */
export function platformTaxaTagFromText(
  text: string | null | undefined,
): string {
  const m = String(text ?? '').match(/\[TENANT:([^\]]+)\]/i);
  return m ? canonicalPlatformTaxaTag(m[1].trim()) : 'GLOBAL';
}

/**
 * Tag de taxas de uma Transaction JÁ gravada: vem exclusivamente de `Transaction.platformTag`
 * (nunca da descrição). Sem tag → GLOBAL. `platformTaxaTagFromText` fica só para texto vindo de fora
 * (produto DOM, itens do checkout) antes de existir uma Transaction.
 */
export function platformTaxaTagForTransaction(tx: {
  platformTag?: string | null;
}): string {
  const tag = transactionPlatformTag(tx);
  return tag ? canonicalPlatformTaxaTag(tag) : 'GLOBAL';
}

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
export function isPhysicalSale(input: {
  isPhysical?: boolean | null;
  description?: string | null;
}): boolean {
  if (input.isPhysical !== undefined && input.isPhysical !== null)
    return Boolean(input.isPhysical);
  return isMaquinetaDescription(input.description);
}

/**
 * Custo DOM em venda FÍSICA (maquineta / POS) — tabela oficial, diferente da online.
 * Valores lidos da tabela de custos sincronizada (canal POS).
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
  const pm = String(input.paymentMethod ?? 'pix').toLowerCase();
  const inst = Math.min(Math.max(Number(input.installments ?? 1) || 1, 1), 12);
  const method =
    !pm.includes('card') && !pm.includes('credit') && !pm.includes('debit')
      ? 'PIX'
      : isPhysicalDebit(input.paymentMethod, input.cardBrand)
        ? 'DEBIT_CARD'
        : 'CREDIT_CARD';
  const cost = syncedAcquirerCostReais(
    method,
    'POS',
    method === 'CREDIT_CARD' ? inst : 1,
    amount,
  );
  if (method === 'PIX') {
    const pct = round4(cost.pct);
    return { pct, fixa: round2(cost.fixa), total: round4(pct + cost.fixa) };
  }
  const pct = round2(cost.pct);
  const fixa = round2(cost.fixa);
  return { pct, fixa, total: round2(pct + fixa) };
}

/** Precisão para MDR % sobre valores baixos (ex.: 0,98% de R$ 1,00 = R$ 0,0098). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Estima taxa DOM quando a listagem não traz mdr_value/dom_fee (comum no GET /transactions).
 * Valores lidos da tabela de custos sincronizada da adquirente (canal ONLINE).
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

  const method = pm.includes('boleto')
    ? 'BOLETO'
    : pm.includes('debit')
      ? 'DEBIT_CARD'
      : pm.includes('card') || pm.includes('credit')
        ? 'CREDIT_CARD'
        : 'PIX';
  const cost = syncedAcquirerCostReais(
    method,
    'ONLINE',
    method === 'CREDIT_CARD' ? inst : 1,
    amount,
  );
  return method === 'PIX' ? round4(cost.total) : round2(cost.total);
}

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
  const fromApi = Number(input.mdrFromGateway ?? input.domFeeFromGateway ?? 0);
  const estimate = () =>
    estimateDomFeeReais({
      amountReais: input.amountReais,
      paymentMethod: input.paymentMethod,
      installments: input.installments,
      tenantTag: input.tenantTag,
      isPhysical: input.isPhysical,
      description: input.description,
      cardBrand: input.cardBrand,
    });

  if (Number.isFinite(fromApi) && fromApi > 0) {
    return round4(fromApi);
  }
  return estimate();
}
