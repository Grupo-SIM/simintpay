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
  // DOM: taxa cobrada do comprador pelo gateway para cartão direto/pix-plan
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
  // Master: juros cobrados do comprador pela plataforma em links de pagamento
  // Default = taxa total anunciada - taxa DOM do link
  MDR_LINK_1X:  0.0152,  // 1,52% (total 1,52% − DOM 0,00%)
  MDR_LINK_2X:  0.0352,  // 3,52% (total 8,03% − DOM 4,51%)
  MDR_LINK_3X:  0.0573,  // 5,73% (total 11,77% − DOM 6,04%)
  MDR_LINK_4X:  0.0916,  // 9,16% (total 16,75% − DOM 7,59%)
  MDR_LINK_5X:  0.1104,  // 11,04% (total 20,19% − DOM 9,15%)
  MDR_LINK_6X:  0.1299,  // 12,99% (total 23,71% − DOM 10,72%)
  MDR_LINK_7X:  0.1371,  // 13,71% (total 26,02% − DOM 12,31%)
  MDR_LINK_8X:  0.1320,  // 13,20% (total 27,12% − DOM 13,92%)
  MDR_LINK_9X:  0.1303,  // 13,03% (total 28,57% − DOM 15,54%)
  MDR_LINK_10X: 0.1290,  // 12,90% (total 30,07% − DOM 17,17%)
  MDR_LINK_11X: 0.1483,  // 14,83% (total 33,65% − DOM 18,82%)
  MDR_LINK_12X: 0.1556,  // 15,56% (total 36,04% − DOM 20,48%)
  // Master adicional sobre cartão ao absorver juros (mesmo padrão do MDR_LINK)
  MDR_CC_MASTER_1X:  0.0152,
  MDR_CC_MASTER_2X:  0.0352,
  MDR_CC_MASTER_3X:  0.0573,
  MDR_CC_MASTER_4X:  0.0916,
  MDR_CC_MASTER_5X:  0.1104,
  MDR_CC_MASTER_6X:  0.1299,
  MDR_CC_MASTER_7X:  0.1371,
  MDR_CC_MASTER_8X:  0.1320,
  MDR_CC_MASTER_9X:  0.1303,
  MDR_CC_MASTER_10X: 0.1290,
  MDR_CC_MASTER_11X: 0.1483,
  MDR_CC_MASTER_12X: 0.1556,
};
