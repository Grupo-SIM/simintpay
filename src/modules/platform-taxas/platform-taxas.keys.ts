/** Sufixo após `{PLATAFORMA}_` no .env (alinhado ao front). */
export const PLATAFORMA_TAXA_KEYS = [
  'MDR_PIX',
  'TAXA_SAQUE_FIXA',
  'TAXA_SAQUE_PERCENT',
  'SAQUE_MIN',
  'LIQUIDEZ',
  'TAXA_FIXA_TRANSACAO',
  'TAXA_CASHBACK',
  'TAXA_LINK_PERCENT',   // Taxa % da casa sobre links de pagamento (padrão 6.99%)
  'TAXA_LINK_FIXA',      // Taxa fixa da casa sobre links de pagamento (padrão R$ 4.00)
  'TAXA_ASSINATURA',     // Taxa % da casa sobre links de assinatura (padrão 9.0%)
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
] as const;

export type PlataformaTaxaKey = (typeof PLATAFORMA_TAXA_KEYS)[number];

/** Fallback quando .env não define a variável (mesmos defaults dos módulos). */
export const PLATFORM_TAXA_DEFAULTS: Record<PlataformaTaxaKey, number> = {
  MDR_PIX: 0.0098,
  TAXA_SAQUE_FIXA: 2,
  TAXA_SAQUE_PERCENT: 0,
  SAQUE_MIN: 100,
  LIQUIDEZ: 0.91,
  TAXA_FIXA_TRANSACAO: 1.0,
  TAXA_CASHBACK: 3.0,
  TAXA_LINK_PERCENT: 0.0699,
  TAXA_LINK_FIXA: 4.0,
  TAXA_ASSINATURA: 9.0,
  MDR_CC_1X: 0.0399,
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
};
