/** Historical constants for legacy projections; never persisted as editable overrides. */
export const LEGACY_TAXA_KEYS = [
  'TAXA_SAQUE_EXTRA', // Extra do admin (R$) somado à maior taxa de saque entre adquirentes
  'TAXA_SAQUE_DOM',
  'TAXA_SAQUE_PERCENT',
  'SAQUE_MIN',
  'LIQUIDEZ',
  'TAXA_FIXA_TRANSACAO',
  'CASHBACK_DOM_ATIVO', // 1 = DOM gera cashback e cobra o custo; 0 = cashback desativado nas transações
  'CASHBACK_DOM_VALOR', // Bônus (R$) concedido ao comprador em compras de outras adquirentes; 0 = não concede
  'CASHBACK_DOM_CUSTO', // Custo fixo (R$) do cashback DOM por transação online
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
  // Taxa master (plataforma) sobre link de pagamento por parcela — configurável
  // Taxa master (plataforma) adicional sobre cartão ao absorver juros — configurável
  // ── Vendas FÍSICAS (maquineta / POS) ──────────────────────────────────────
  // Taxa Sim Int Pay em venda física — editável, por método.
  // O cliente só perde esta taxa; o custo DOM sai da margem Sim Int Pay.
  'POS_TAXA_PIX_PERCENT',
  'POS_TAXA_DEBITO_PERCENT',
  // Crédito físico: taxa da casa por parcela,
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

/** Cashback DOM (R$) já embutido nos créditos de webhooks legados; nunca muda com a configuração atual. */
export const LEGACY_DOM_CASHBACK_REAIS = 3;

/** Padrões únicos quando nenhum override de plataforma ou global existe. */
export const PLATFORM_TAXA_DEFAULTS: Record<PlataformaTaxaKey, number> = {
  /** Taxa DOM sobre PIX (decimal): 0,98% sobre o valor pago. Sobrescreva pelo painel admin. */
  TAXA_SAQUE_EXTRA: 0,
  TAXA_SAQUE_DOM: 3.5,
  TAXA_SAQUE_PERCENT: 0,
  SAQUE_MIN: 100,
  LIQUIDEZ: 0.9301,
  TAXA_FIXA_TRANSACAO: 1.0,
  CASHBACK_DOM_ATIVO: 1,
  CASHBACK_DOM_VALOR: 0,
  CASHBACK_DOM_CUSTO: 0,
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
  // Custos SimIntPay do vendedor, independentes dos juros do comprador.
  // Juros legados do comprador: pagamento à vista não tem juros.
  // Master adicional sobre cartão ao absorver juros
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
  'CASHBACK_DOM_ATIVO',
  'CASHBACK_DOM_CUSTO',
  'CASHBACK_DOM_VALOR',
] as const;
export function isEditablePlatformTaxaKey(key: string): boolean {
  return (EDITABLE_PLATFORM_TAXA_KEYS as readonly string[]).includes(key);
}
