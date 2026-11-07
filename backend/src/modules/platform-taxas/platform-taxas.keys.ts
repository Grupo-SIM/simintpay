/** Historical constants for legacy projections; never persisted as editable overrides. */
export const LEGACY_TAXA_KEYS = [
  'MDR_PIX',
  'TAXA_SAQUE_EXTRA', // Extra do admin (R$) somado à maior taxa de saque entre adquirentes
  'TAXA_SAQUE_DOM',
  'TAXA_SAQUE_PERCENT',
  'SAQUE_MIN',
  'LIQUIDEZ',
  'TAXA_FIXA_TRANSACAO',
  'TAXA_CASHBACK',
  'TAXA_SERVICO', // Taxa de Serviço Sim Int Pay (padrão R$ 4.00)
  'TAXA_COMISSAO_AFILIADO', // Comissão % de afiliado sobre venda de livro afiliado (ebook) (padrão 10%)
  'TAXA_LINK_PERCENT', // Taxa % da casa sobre links de pagamento (padrão 9%)
  'TAXA_LINK_FIXA', // Taxa fixa da casa sobre links de pagamento (padrão R$ 4.00)
  'TAXA_DEBITO_PERCENT', // Taxa % da plataforma sobre débito (padrão 2%)
  'TAXA_DEBITO_FIXA', // Taxa fixa R$ da plataforma sobre débito (padrão R$2,00)
  // Boleto — taxa fixa por boleto pago. SimIntPay (editável) inclui o custo DOM (desmembrado).
  'TAXA_BOLETO_FIXA', // Taxa fixa da casa (SimIntPay) por boleto (padrão R$7,00)
  'TAXA_BOLETO_TRANSACAO', // Taxa fixa por transação da casa no boleto (padrão R$2,00)
  // Taxa DOM para cartão (crédito direto / pix-plan / assinatura) — read-only
  'MDR_CC_1X',
  'MDR_CC_2X',
  'MDR_CC_3X',
  'MDR_CC_4X',
  'MDR_CC_5X',
  'MDR_CC_6X',
  'MDR_CC_7X',
  'MDR_CC_8X',
  'MDR_CC_9X',
  'MDR_CC_10X',
  'MDR_CC_11X',
  'MDR_CC_12X',
  // Taxa master (plataforma) sobre link de pagamento por parcela — configurável
  'LINK_COST_1X',
  'LINK_COST_2X',
  'LINK_COST_3X',
  'LINK_COST_4X',
  'LINK_COST_5X',
  'LINK_COST_6X',
  'LINK_COST_7X',
  'LINK_COST_8X',
  'LINK_COST_9X',
  'LINK_COST_10X',
  'LINK_COST_11X',
  'LINK_COST_12X',
  'MDR_LINK_1X',
  'MDR_LINK_2X',
  'MDR_LINK_3X',
  'MDR_LINK_4X',
  'MDR_LINK_5X',
  'MDR_LINK_6X',
  'MDR_LINK_7X',
  'MDR_LINK_8X',
  'MDR_LINK_9X',
  'MDR_LINK_10X',
  'MDR_LINK_11X',
  'MDR_LINK_12X',
  // Taxa master (plataforma) adicional sobre cartão ao absorver juros — configurável
  'MDR_CC_MASTER_1X',
  'MDR_CC_MASTER_2X',
  'MDR_CC_MASTER_3X',
  'MDR_CC_MASTER_4X',
  'MDR_CC_MASTER_5X',
  'MDR_CC_MASTER_6X',
  'MDR_CC_MASTER_7X',
  'MDR_CC_MASTER_8X',
  'MDR_CC_MASTER_9X',
  'MDR_CC_MASTER_10X',
  'MDR_CC_MASTER_11X',
  'MDR_CC_MASTER_12X',
  // ── Vendas FÍSICAS (maquineta / POS) ──────────────────────────────────────
  // Taxa Sim Int Pay em venda física — editável, por método.
  // O cliente só perde esta taxa; o custo DOM sai da margem Sim Int Pay.
  'POS_TAXA_PIX_PERCENT',
  'POS_TAXA_DEBITO_PERCENT',
  // Crédito físico: taxa da casa por parcela (mesmo padrão do MDR_CC_MASTER online),
  // porque o custo DOM cresce com o parcelamento e uma taxa única daria prejuízo.
  'POS_TAXA_CREDITO_1X',
  'POS_TAXA_CREDITO_2X',
  'POS_TAXA_CREDITO_3X',
  'POS_TAXA_CREDITO_4X',
  'POS_TAXA_CREDITO_5X',
  'POS_TAXA_CREDITO_6X',
  'POS_TAXA_CREDITO_7X',
  'POS_TAXA_CREDITO_8X',
  'POS_TAXA_CREDITO_9X',
  'POS_TAXA_CREDITO_10X',
  'POS_TAXA_CREDITO_11X',
  'POS_TAXA_CREDITO_12X',
  // Toggle: 1 = custo DOM sai da margem Sim Int Pay (padrão, comportamento atual).
  // 0 = custo DOM é descontado do repasse ao lojista (netAmount da venda física).
  // Só afeta transações NOVAS a partir do momento em que é alternado.
  'POS_ABSORVER_TAXAS',
] as const;

export type PlataformaTaxaKey = (typeof LEGACY_TAXA_KEYS)[number];

/** Padrões únicos quando nenhum override de plataforma ou global existe. */
export const PLATFORM_TAXA_DEFAULTS: Record<PlataformaTaxaKey, number> = {
  /** Taxa DOM sobre PIX (decimal): 0,98% sobre o valor pago. Sobrescreva pelo painel admin. */
  MDR_PIX: 0.0098,
  TAXA_SAQUE_EXTRA: 0,
  TAXA_SAQUE_DOM: 3.5,
  TAXA_SAQUE_PERCENT: 0,
  SAQUE_MIN: 100,
  LIQUIDEZ: 0.9301,
  TAXA_FIXA_TRANSACAO: 1.0,
  TAXA_CASHBACK: 3.0,
  TAXA_SERVICO: 4.0,
  TAXA_COMISSAO_AFILIADO: 0.1, // 10%
  TAXA_LINK_PERCENT: 0.09,
  TAXA_LINK_FIXA: 4.0,
  TAXA_DEBITO_PERCENT: 0.02, // 2%
  TAXA_DEBITO_FIXA: 2.0, // R$2,00
  // Boleto (valores fixos em R$ por boleto pago)
  TAXA_BOLETO_FIXA: 7.0, // SimIntPay: R$7,00
  TAXA_BOLETO_TRANSACAO: 2.0, // SimIntPay: R$2,00 por transação
  // DOM: taxa cobrada pelo gateway para cartão direto/pix-plan/assinatura
  // 1x = 0% (igual ao link de pagamento — custo real DOM ~3,99% é absorvido pelo master e visível nos relatórios)
  MDR_CC_1X: 0,
  MDR_CC_2X: 0.083,
  MDR_CC_3X: 0.0968,
  MDR_CC_4X: 0.1104,
  MDR_CC_5X: 0.1237,
  MDR_CC_6X: 0.1367,
  MDR_CC_7X: 0.1495,
  MDR_CC_8X: 0.1621,
  MDR_CC_9X: 0.1744,
  MDR_CC_10X: 0.1864,
  MDR_CC_11X: 0.1983,
  MDR_CC_12X: 0.2099,
  // Custos SimIntPay do vendedor, independentes dos juros do comprador.
  LINK_COST_1X: 0.09,
  LINK_COST_2X: 0.09,
  LINK_COST_3X: 0.09,
  LINK_COST_4X: 0.09,
  LINK_COST_5X: 0.09,
  LINK_COST_6X: 0.09,
  LINK_COST_7X: 0.09,
  LINK_COST_8X: 0.09,
  LINK_COST_9X: 0.09,
  LINK_COST_10X: 0.09,
  LINK_COST_11X: 0.09,
  LINK_COST_12X: 0.09,
  // Juros legados do comprador: pagamento à vista não tem juros.
  MDR_LINK_1X: 0,
  MDR_LINK_2X: 0.0352, // 3,52% (total 8,03% − DOM 4,51%)
  MDR_LINK_3X: 0.0573, // 5,73% (total 11,77% − DOM 6,04%)
  MDR_LINK_4X: 0.0916, // 9,16% (total 16,75% − DOM 7,59%)
  MDR_LINK_5X: 0.1104, // 11,04% (total 20,19% − DOM 9,15%)
  MDR_LINK_6X: 0.1299, // 12,99% (total 23,71% − DOM 10,72%)
  MDR_LINK_7X: 0.1371, // 13,71% (total 26,02% − DOM 12,31%)
  MDR_LINK_8X: 0.132, // 13,20% (total 27,12% − DOM 13,92%)
  MDR_LINK_9X: 0.1303, // 13,03% (total 28,57% − DOM 15,54%)
  MDR_LINK_10X: 0.129, // 12,90% (total 30,07% − DOM 17,17%)
  MDR_LINK_11X: 0.1483, // 14,83% (total 33,65% − DOM 18,82%)
  MDR_LINK_12X: 0.1556, // 15,56% (total 36,04% − DOM 20,48%)
  // Master adicional sobre cartão ao absorver juros (mesmo padrão do MDR_LINK)
  MDR_CC_MASTER_1X: 0.0152,
  MDR_CC_MASTER_2X: 0.0352,
  MDR_CC_MASTER_3X: 0.0573,
  MDR_CC_MASTER_4X: 0.0916,
  MDR_CC_MASTER_5X: 0.1104,
  MDR_CC_MASTER_6X: 0.1299,
  MDR_CC_MASTER_7X: 0.1371,
  MDR_CC_MASTER_8X: 0.132,
  MDR_CC_MASTER_9X: 0.1303,
  MDR_CC_MASTER_10X: 0.129,
  MDR_CC_MASTER_11X: 0.1483,
  MDR_CC_MASTER_12X: 0.1556,
  // ── Vendas FÍSICAS (maquineta / POS) — tabela oficial DOM ─────────────────
  // Mastercard/Visa e demais bandeiras têm as mesmas taxas (não separar por bandeira).
  // Não há cobrança de cashback (R$3) em venda física — confirmado pelo suporte DOM.
  // Taxa Sim Int Pay em venda física (antes: TAXA_MAQUINETA hardcoded 9% para tudo)
  POS_TAXA_PIX_PERCENT: 0.09,
  POS_TAXA_DEBITO_PERCENT: 0.09,
  // Crédito físico por parcela = custo DOM da parcela + 5,51 p.p.
  // Os 5,51 p.p. preservam a margem líquida de hoje (R$4,51 por R$100 em 1x, já
  // descontada a taxa fixa de R$1 da DOM). 1x continua exatamente 9%, como antes.
  POS_TAXA_CREDITO_1X: 0.09,
  POS_TAXA_CREDITO_2X: 0.1171,
  POS_TAXA_CREDITO_3X: 0.1246,
  POS_TAXA_CREDITO_4X: 0.1318,
  POS_TAXA_CREDITO_5X: 0.1389,
  POS_TAXA_CREDITO_6X: 0.1546,
  POS_TAXA_CREDITO_7X: 0.1612,
  POS_TAXA_CREDITO_8X: 0.1677,
  POS_TAXA_CREDITO_9X: 0.1732,
  POS_TAXA_CREDITO_10X: 0.1802,
  POS_TAXA_CREDITO_11X: 0.1861,
  POS_TAXA_CREDITO_12X: 0.192,
  // 1 = ligado (absorve, comportamento atual/default). 0 = desligado (repassa).
  POS_ABSORVER_TAXAS: 1,
};

/** Only these scalar overrides are editable in /admin/taxas. Payment fees use FinancialPolicyRevision. */
export const EDITABLE_PLATFORM_TAXA_KEYS = [
  'SAQUE_MIN',
  'TAXA_SAQUE_EXTRA',
] as const;
export function isEditablePlatformTaxaKey(key: string): boolean {
  return (EDITABLE_PLATFORM_TAXA_KEYS as readonly string[]).includes(key);
}
