/** Chaves alinhadas ao sufixo após `{PLATAFORMA}_` no .env (ex.: RENOVADA_MDR_PIX → MDR_PIX). */
export const PLATAFORMA_TAXA_KEYS = [
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
  'MDR_PIX',
  'TAXA_SAQUE_FIXA',
  'TAXA_SAQUE_PERCENT',
  'SAQUE_MIN',
  'LIQUIDEZ',
  'TAXA_FIXA_TRANSACAO',
  'TAXA_CASHBACK',
  'TAXA_SERVICO',
  'TAXA_COMISSAO_AFILIADO',
  'TAXA_LINK_PERCENT',
  'TAXA_LINK_FIXA',
  'TAXA_ASSINATURA',
  'TAXA_DEBITO_PERCENT',
  'TAXA_DEBITO_FIXA',
  'TAXA_BOLETO_FIXA',
  'TAXA_BOLETO_TRANSACAO',
  'TAXA_BOLETO_DOM',
  'TAXA_BOLETO_DOM_FIXA',
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
  // ── Vendas FÍSICAS (maquineta / POS) ──
  'POS_MDR_PIX',
  'POS_MDR_DEBITO',
  'POS_TAXA_DOM_FIXA',
  'POS_MDR_CC_1X',
  'POS_MDR_CC_2X',
  'POS_MDR_CC_3X',
  'POS_MDR_CC_4X',
  'POS_MDR_CC_5X',
  'POS_MDR_CC_6X',
  'POS_MDR_CC_7X',
  'POS_MDR_CC_8X',
  'POS_MDR_CC_9X',
  'POS_MDR_CC_10X',
  'POS_MDR_CC_11X',
  'POS_MDR_CC_12X',
  'POS_TAXA_PIX_PERCENT',
  'POS_TAXA_DEBITO_PERCENT',
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
  // Toggle: 1 = custo DOM sai da margem Sim Int Pay (padrão). 0 = repassa ao cliente.
  'POS_ABSORVER_TAXAS',
] as const;

export type PlataformaTaxaKey = (typeof PLATAFORMA_TAXA_KEYS)[number];

/** Agrupamento para UI. */
export type PlataformaTaxaSection = {
  id: string;
  title: string;
  keys: readonly PlataformaTaxaKey[];
};

const MDR_CC_KEYS = PLATAFORMA_TAXA_KEYS.filter(
  (k): k is PlataformaTaxaKey =>
    k.startsWith('MDR_CC') && !k.startsWith('MDR_CC_MASTER'),
);

const MDR_CC_MASTER_KEYS = PLATAFORMA_TAXA_KEYS.filter(
  (k): k is PlataformaTaxaKey => k.startsWith('MDR_CC_MASTER'),
);

const MDR_LINK_KEYS = PLATAFORMA_TAXA_KEYS.filter((k): k is PlataformaTaxaKey =>
  k.startsWith('MDR_LINK'),
);

/** Custo DOM do crédito em venda física, por parcela (read-only). */
const POS_MDR_CC_KEYS = PLATAFORMA_TAXA_KEYS.filter(
  (k): k is PlataformaTaxaKey => k.startsWith('POS_MDR_CC'),
);

/** Taxa Sim Int Pay do crédito em venda física, por parcela (editável). */
const POS_TAXA_CREDITO_KEYS = PLATAFORMA_TAXA_KEYS.filter(
  (k): k is PlataformaTaxaKey => k.startsWith('POS_TAXA_CREDITO_'),
);

export const PLATAFORMA_TAXA_SECTIONS: PlataformaTaxaSection[] = [
  {
    id: 'link_cost',
    title: 'Custo SimIntPay para a plataforma — links de pagamento',
    keys: PLATAFORMA_TAXA_KEYS.filter((key) => key.startsWith('LINK_COST_')),
  },
  {
    id: 'saque',
    title: 'Saque',
    keys: ['SAQUE_MIN', 'TAXA_SAQUE_FIXA'],
  },
  {
    id: 'operacao',
    title: 'PIX e taxas por transação',
    keys: [
      'LIQUIDEZ',
      'MDR_PIX',
      'TAXA_FIXA_TRANSACAO',
      'TAXA_CASHBACK',
      'TAXA_SERVICO',
    ],
  },
  // {
  //   id: "afiliados",
  //   title: "Programa de Afiliados",
  //   keys: ["TAXA_COMISSAO_AFILIADO"],
  // },
  {
    id: 'links',
    title: 'Taxas de cartão de crédito Cliente(vendedor)',
    keys: ['TAXA_LINK_PERCENT', 'TAXA_LINK_FIXA'],
  },
  {
    id: 'debito',
    title: 'Cartão de Débito',
    keys: ['TAXA_DEBITO_PERCENT', 'TAXA_DEBITO_FIXA'],
  },
  {
    id: 'boleto',
    title: 'Boleto',
    keys: [
      'TAXA_BOLETO_FIXA',
      'TAXA_BOLETO_TRANSACAO',
      'TAXA_BOLETO_DOM',
      'TAXA_BOLETO_DOM_FIXA',
    ],
  },
  {
    id: 'cartao',
    title: 'Cartão de Crédito',
    keys: MDR_CC_KEYS,
  },
  {
    id: 'cartao_master',
    title: 'Cartão de Crédito — Master',
    keys: MDR_CC_MASTER_KEYS,
  },
  {
    id: 'link_cartao',
    title: 'Link de Pagamento — Parcelamento',
    keys: MDR_LINK_KEYS,
  },
  {
    id: 'pos',
    title: 'Vendas físicas (maquineta)',
    keys: [
      'POS_TAXA_PIX_PERCENT',
      'POS_MDR_PIX',
      'POS_TAXA_DEBITO_PERCENT',
      'POS_MDR_DEBITO',
      'POS_TAXA_DOM_FIXA',
    ],
  },
  {
    id: 'pos_cc',
    title: 'Vendas físicas — crédito por parcela',
    keys: POS_TAXA_CREDITO_KEYS,
  },
];

/**
 * Taxas cobradas diretamente pela DOM Pagamentos — exibidas apenas para
 * referência, não podem ser editadas pelo administrador da plataforma.
 */
export const PLATAFORMA_TAXA_DOM_READONLY: ReadonlySet<PlataformaTaxaKey> =
  new Set([
    'MDR_PIX',
    'TAXA_FIXA_TRANSACAO',
    'TAXA_CASHBACK',
    'TAXA_BOLETO_DOM',
    'TAXA_BOLETO_DOM_FIXA',
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
  ]);

/**
 * Taxas da DOM em venda física. Diferente das online, são EDITÁVEIS: a DOM
 * publica essa tabela no painel dela e pode revisá-la, então o admin ajusta
 * aqui sem depender de deploy. Os defaults seguem a tabela oficial vigente.
 */
const POS_DOM_KEYS: readonly PlataformaTaxaKey[] = [
  'POS_MDR_PIX',
  'POS_MDR_DEBITO',
  'POS_TAXA_DOM_FIXA',
  ...POS_MDR_CC_KEYS,
];

/**
 * Campos que exibem o selo "DOM" (custo da operadora). Inclui os read-only
 * das vendas online e os editáveis das vendas físicas.
 */
export const PLATAFORMA_TAXA_DOM_BADGE: ReadonlySet<PlataformaTaxaKey> =
  new Set([...PLATAFORMA_TAXA_DOM_READONLY, ...POS_DOM_KEYS]);

/** Campos que são valores fixos em R$ — os demais são percentuais (0.0098 → 0.98%). */
export const PLATAFORMA_TAXA_FIXED_BRL: ReadonlySet<PlataformaTaxaKey> =
  new Set([
    'TAXA_SAQUE_FIXA',
    'SAQUE_MIN',
    'TAXA_FIXA_TRANSACAO',
    'TAXA_CASHBACK',
    'TAXA_LINK_FIXA',
    'TAXA_SERVICO',
    'TAXA_DEBITO_FIXA',
    'TAXA_BOLETO_FIXA',
    'TAXA_BOLETO_TRANSACAO',
    'TAXA_BOLETO_DOM',
    'TAXA_BOLETO_DOM_FIXA',
    'POS_TAXA_DOM_FIXA',
  ]);

/** Converte valor do banco (ex: 0.0098) para exibição (ex: "0.98"). */
export function taxaToDisplay(key: PlataformaTaxaKey, value: number): string {
  if (PLATAFORMA_TAXA_FIXED_BRL.has(key)) return String(value);
  if (key === 'LIQUIDEZ') {
    return String(parseFloat(((1 - value) * 100).toPrecision(10)));
  }
  return String(parseFloat((value * 100).toPrecision(10)));
}

/** Converte valor digitado pelo usuário (ex: "0.98") para o banco (ex: 0.0098). */
export function taxaFromDisplay(key: PlataformaTaxaKey, input: string): number {
  const n = Number(input.trim().replace(',', '.'));
  if (!Number.isFinite(n)) return NaN;
  if (PLATAFORMA_TAXA_FIXED_BRL.has(key)) return n;
  if (key === 'LIQUIDEZ') {
    return (100 - n) / 100;
  }
  return n / 100;
}

export const PLATAFORMA_TAXA_LABELS: Record<PlataformaTaxaKey, string> = {
  LINK_COST_1X: 'Custo SimIntPay — 1x (%)',
  LINK_COST_2X: 'Custo SimIntPay — 2x (%)',
  LINK_COST_3X: 'Custo SimIntPay — 3x (%)',
  LINK_COST_4X: 'Custo SimIntPay — 4x (%)',
  LINK_COST_5X: 'Custo SimIntPay — 5x (%)',
  LINK_COST_6X: 'Custo SimIntPay — 6x (%)',
  LINK_COST_7X: 'Custo SimIntPay — 7x (%)',
  LINK_COST_8X: 'Custo SimIntPay — 8x (%)',
  LINK_COST_9X: 'Custo SimIntPay — 9x (%)',
  LINK_COST_10X: 'Custo SimIntPay — 10x (%)',
  LINK_COST_11X: 'Custo SimIntPay — 11x (%)',
  LINK_COST_12X: 'Custo SimIntPay — 12x (%)',

  MDR_PIX: 'Taxa PIX',
  TAXA_SAQUE_FIXA: 'Taxa fixa de saque (R$)',
  TAXA_SAQUE_PERCENT: 'Taxa de saque (%)',
  SAQUE_MIN: 'Saque mínimo (R$)',
  LIQUIDEZ: 'Taxa de PIX (Sim Int Pay)',
  TAXA_FIXA_TRANSACAO: 'Taxa fixa de transação (R$)',
  TAXA_CASHBACK: 'Taxa de Cashback fixo (R$)',
  TAXA_SERVICO: 'Taxa de Transação (R$)',
  TAXA_COMISSAO_AFILIADO: 'Comissão de Afiliado (%)',
  TAXA_LINK_PERCENT: 'Taxa de cartão de crédito (%)',
  TAXA_LINK_FIXA: 'Taxa de transação crédito (R$)',
  TAXA_ASSINATURA: 'Taxa do link de assinatura (%)',
  TAXA_DEBITO_PERCENT: 'Taxa plataforma débito (%)',
  TAXA_DEBITO_FIXA: 'Taxa de transação débito (R$)',
  TAXA_BOLETO_FIXA: 'Taxa de boleto Sim Int Pay (R$)',
  TAXA_BOLETO_TRANSACAO: 'Taxa de transação boleto (R$)',
  TAXA_BOLETO_DOM: 'Taxa DOM boleto (R$)',
  TAXA_BOLETO_DOM_FIXA: 'Taxa fixa DOM boleto (R$)',
  MDR_CC_1X: '1x',
  MDR_CC_2X: '2x',
  MDR_CC_3X: '3x',
  MDR_CC_4X: '4x',
  MDR_CC_5X: '5x',
  MDR_CC_6X: '6x',
  MDR_CC_7X: '7x',
  MDR_CC_8X: '8x',
  MDR_CC_9X: '9x',
  MDR_CC_10X: '10x',
  MDR_CC_11X: '11x',
  MDR_CC_12X: '12x',
  MDR_LINK_1X: '1x',
  MDR_LINK_2X: '2x',
  MDR_LINK_3X: '3x',
  MDR_LINK_4X: '4x',
  MDR_LINK_5X: '5x',
  MDR_LINK_6X: '6x',
  MDR_LINK_7X: '7x',
  MDR_LINK_8X: '8x',
  MDR_LINK_9X: '9x',
  MDR_LINK_10X: '10x',
  MDR_LINK_11X: '11x',
  MDR_LINK_12X: '12x',
  MDR_CC_MASTER_1X: '1x',
  MDR_CC_MASTER_2X: '2x',
  MDR_CC_MASTER_3X: '3x',
  MDR_CC_MASTER_4X: '4x',
  MDR_CC_MASTER_5X: '5x',
  MDR_CC_MASTER_6X: '6x',
  MDR_CC_MASTER_7X: '7x',
  MDR_CC_MASTER_8X: '8x',
  MDR_CC_MASTER_9X: '9x',
  MDR_CC_MASTER_10X: '10x',
  MDR_CC_MASTER_11X: '11x',
  MDR_CC_MASTER_12X: '12x',
  POS_TAXA_PIX_PERCENT: 'Taxa PIX físico (Sim Int Pay)',
  POS_TAXA_DEBITO_PERCENT: 'Taxa débito físico (Sim Int Pay)',
  POS_TAXA_CREDITO_1X: '1x',
  POS_TAXA_CREDITO_2X: '2x',
  POS_TAXA_CREDITO_3X: '3x',
  POS_TAXA_CREDITO_4X: '4x',
  POS_TAXA_CREDITO_5X: '5x',
  POS_TAXA_CREDITO_6X: '6x',
  POS_TAXA_CREDITO_7X: '7x',
  POS_TAXA_CREDITO_8X: '8x',
  POS_TAXA_CREDITO_9X: '9x',
  POS_TAXA_CREDITO_10X: '10x',
  POS_TAXA_CREDITO_11X: '11x',
  POS_TAXA_CREDITO_12X: '12x',
  POS_MDR_PIX: 'Taxa DOM PIX físico',
  POS_MDR_DEBITO: 'Taxa DOM débito físico',
  POS_TAXA_DOM_FIXA: 'Taxa fixa DOM por transação física (R$)',
  POS_MDR_CC_1X: '1x',
  POS_MDR_CC_2X: '2x',
  POS_MDR_CC_3X: '3x',
  POS_MDR_CC_4X: '4x',
  POS_MDR_CC_5X: '5x',
  POS_MDR_CC_6X: '6x',
  POS_MDR_CC_7X: '7x',
  POS_MDR_CC_8X: '8x',
  POS_MDR_CC_9X: '9x',
  POS_MDR_CC_10X: '10x',
  POS_MDR_CC_11X: '11x',
  POS_MDR_CC_12X: '12x',
  POS_ABSORVER_TAXAS: 'Absorver taxas de maquineta',
};

export const PLATAFORMA_TAXA_DESCRIPTIONS: Partial<
  Record<PlataformaTaxaKey, string>
> = {
  LINK_COST_1X:
    'Percentual cobrado pela SimIntPay da plataforma em 1x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_2X:
    'Percentual cobrado pela SimIntPay da plataforma em 2x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_3X:
    'Percentual cobrado pela SimIntPay da plataforma em 3x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_4X:
    'Percentual cobrado pela SimIntPay da plataforma em 4x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_5X:
    'Percentual cobrado pela SimIntPay da plataforma em 5x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_6X:
    'Percentual cobrado pela SimIntPay da plataforma em 6x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_7X:
    'Percentual cobrado pela SimIntPay da plataforma em 7x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_8X:
    'Percentual cobrado pela SimIntPay da plataforma em 8x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_9X:
    'Percentual cobrado pela SimIntPay da plataforma em 9x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_10X:
    'Percentual cobrado pela SimIntPay da plataforma em 10x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_11X:
    'Percentual cobrado pela SimIntPay da plataforma em 11x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',
  LINK_COST_12X:
    'Percentual cobrado pela SimIntPay da plataforma em 12x. Somado à taxa fixa de link; independente dos juros definidos pelo proprietário para seus clientes.',

  MDR_PIX:
    'Taxa cobrada pela operadora (DOM) em cada transação aprovada via PIX. Valor de referência — não editável.',
  TAXA_SAQUE_FIXA:
    'Valor fixo em reais debitado automaticamente em cada pedido de saque solicitado pelo vendedor.',
  TAXA_SAQUE_PERCENT:
    'Porcentagem adicional descontada sobre o valor bruto do saque solicitado pelo vendedor.',
  SAQUE_MIN:
    'Saldo mínimo disponível em conta necessário para que a opção de saque seja liberada ao vendedor.',
  LIQUIDEZ:
    'Taxa percentual cobrada pela Sim Int Pay sobre cada transação aprovada via PIX. Deduzida automaticamente do valor bruto recebido pelo vendedor.',
  TAXA_FIXA_TRANSACAO:
    'Valor fixo em reais cobrado por cada transação aprovada, independente do método de pagamento.',
  TAXA_CASHBACK:
    'Valor fixo em reais reservado por transação para o programa de cashback da plataforma.',
  TAXA_SERVICO:
    'Taxa de Transação Sim Int Pay — valor fixo cobrado por transação para cobrir os custos operacionais da plataforma.',
  TAXA_COMISSAO_AFILIADO:
    'Percentual pago ao admin afiliado (Ebooksim) sobre o valor de cada venda de livro marcado como afiliado, feita através do link do afiliado.',
  TAXA_LINK_PERCENT:
    'Taxa percentual cobrada sobre cada venda aprovada no cartão de crédito. Calculada sobre o valor bruto da transação.',
  TAXA_LINK_FIXA:
    'Valor fixo em reais cobrado por cada transação aprovada no cartão de crédito, além da taxa percentual.',
  TAXA_ASSINATURA:
    'Taxa percentual aplicada sobre cada cobrança recorrente gerada via links de assinatura.',
  TAXA_DEBITO_PERCENT:
    'Taxa percentual cobrada do vendedor em cada transação aprovada via cartão de débito.',
  TAXA_DEBITO_FIXA:
    'Valor fixo em reais cobrado por cada transação aprovada no cartão de débito, além da taxa percentual.',
  TAXA_BOLETO_FIXA:
    'Valor fixo em reais cobrado pela Sim Int Pay por cada boleto pago. Já inclui o custo da DOM (desmembrado abaixo).',
  TAXA_BOLETO_TRANSACAO:
    'Valor fixo em reais adicional por transação de boleto pago, cobrado pela Sim Int Pay.',
  TAXA_BOLETO_DOM:
    'Taxa cobrada pela operadora (DOM) em cada boleto pago. Valor de referência — não editável.',
  TAXA_BOLETO_DOM_FIXA:
    'Taxa fixa adicional da operadora (DOM) por boleto pago. Valor de referência — não editável.',
  POS_TAXA_PIX_PERCENT:
    'Taxa percentual cobrada pela Sim Int Pay em cada PIX aprovado na maquineta. É a única taxa descontada do cliente — o custo da DOM sai da margem da Sim Int Pay.',
  POS_TAXA_DEBITO_PERCENT:
    'Taxa percentual cobrada pela Sim Int Pay em cada venda no débito pela maquineta. É a única taxa descontada do cliente — o custo da DOM sai da margem da Sim Int Pay.',
  POS_MDR_PIX:
    'Taxa cobrada pela operadora (DOM) em cada PIX na maquineta. Sem taxa fixa. Valor de referência — não editável.',
  POS_MDR_DEBITO:
    'Taxa cobrada pela operadora (DOM) em cada venda no débito pela maquineta, além da taxa fixa por transação. Valor de referência — não editável.',
  POS_TAXA_DOM_FIXA:
    'Valor fixo em reais cobrado pela operadora (DOM) por transação física no débito e no crédito. O PIX na maquineta não paga essa taxa. Valor de referência — não editável.',
  POS_ABSORVER_TAXAS:
    'Ligado: o custo da DOM sai da margem da Sim Int Pay — o cliente recebe o bruto menos só a taxa Sim Int Pay. Desligado: o custo da DOM é descontado do repasse ao cliente também. Só afeta vendas novas a partir de agora — vendas já feitas não mudam.',
};

/** Valores mínimos permitidos (em unidade de display: R$ ou %). */
export const PLATAFORMA_TAXA_MIN_DISPLAY: Partial<
  Record<PlataformaTaxaKey, number>
> = {
  LIQUIDEZ: 9, // min 9% (Taxa de PIX Sim Int Pay)
  TAXA_SERVICO: 4,
  TAXA_SAQUE_FIXA: 2,
  TAXA_LINK_PERCENT: 6.99,
  TAXA_LINK_FIXA: 4,
  TAXA_DEBITO_PERCENT: 3.49,
  TAXA_DEBITO_FIXA: 4,
  TAXA_BOLETO_FIXA: 7, // piso: valor de referência (não pode ficar abaixo)
  TAXA_BOLETO_TRANSACAO: 2, // piso: valor de referência (não pode ficar abaixo)
  // Venda física: piso = custo DOM do método (abaixo disso a margem já nasce negativa)
  POS_TAXA_PIX_PERCENT: 1,
  POS_TAXA_DEBITO_PERCENT: 3.49,
  // Crédito físico: piso = custo DOM daquela parcela (abaixo disso a margem nasce negativa)
  POS_TAXA_CREDITO_1X: 3.49,
  POS_TAXA_CREDITO_2X: 6.2,
  POS_TAXA_CREDITO_3X: 6.95,
  POS_TAXA_CREDITO_4X: 7.67,
  POS_TAXA_CREDITO_5X: 8.38,
  POS_TAXA_CREDITO_6X: 9.95,
  POS_TAXA_CREDITO_7X: 10.61,
  POS_TAXA_CREDITO_8X: 11.26,
  POS_TAXA_CREDITO_9X: 11.81,
  POS_TAXA_CREDITO_10X: 12.51,
  POS_TAXA_CREDITO_11X: 13.1,
  POS_TAXA_CREDITO_12X: 13.69,
};

/**
 * Limites convertidos para valor interno.
 * LIQUIDEZ é invertido: valor interno = (100 - display%) / 100.
 * Mínimo display 9% → máximo internal 0.91.
 * Usar isBelowMinDisplay() para comparação correta.
 */
export const PLATAFORMA_TAXA_MIN_INTERNAL: Partial<
  Record<PlataformaTaxaKey, number>
> = {
  LIQUIDEZ: 0.91, // inverted: internal > 0.91 means display < 9%
  TAXA_SERVICO: 4,
  TAXA_SAQUE_FIXA: 2,
  TAXA_LINK_PERCENT: 0.0699,
  TAXA_LINK_FIXA: 4,
  TAXA_DEBITO_PERCENT: 0.0349,
  TAXA_DEBITO_FIXA: 4,
  TAXA_BOLETO_FIXA: 7, // R$ fixo (display = internal)
  TAXA_BOLETO_TRANSACAO: 2,
  POS_TAXA_PIX_PERCENT: 0.01,
  POS_TAXA_DEBITO_PERCENT: 0.0349,
  POS_TAXA_CREDITO_1X: 0.0349,
  POS_TAXA_CREDITO_2X: 0.062,
  POS_TAXA_CREDITO_3X: 0.0695,
  POS_TAXA_CREDITO_4X: 0.0767,
  POS_TAXA_CREDITO_5X: 0.0838,
  POS_TAXA_CREDITO_6X: 0.0995,
  POS_TAXA_CREDITO_7X: 0.1061,
  POS_TAXA_CREDITO_8X: 0.1126,
  POS_TAXA_CREDITO_9X: 0.1181,
  POS_TAXA_CREDITO_10X: 0.1251,
  POS_TAXA_CREDITO_11X: 0.131,
  POS_TAXA_CREDITO_12X: 0.1369,
};

/**
 * Retorna true se o valor interno está abaixo do mínimo de display.
 * Usa lógica invertida para LIQUIDEZ (escala inversa).
 */
export function isBelowMinDisplay(
  key: PlataformaTaxaKey,
  internalValue: number,
): boolean {
  const minDisp = PLATAFORMA_TAXA_MIN_DISPLAY[key];
  if (minDisp === undefined || !Number.isFinite(internalValue)) return false;
  if (key === 'LIQUIDEZ') {
    const dispVal = parseFloat(((1 - internalValue) * 100).toPrecision(10));
    return dispVal < minDisp;
  }
  const minInt = PLATAFORMA_TAXA_MIN_INTERNAL[key];
  if (minInt === undefined) return false;
  return internalValue < minInt;
}

export {
  MDR_CC_MASTER_KEYS,
  POS_MDR_CC_KEYS,
  POS_TAXA_CREDITO_KEYS,
  POS_DOM_KEYS,
};

/** Número de parcelas para as chaves MDR_CC, MDR_CC_MASTER e MDR_LINK. */
export function installmentFromKey(key: PlataformaTaxaKey): number {
  const m = key.match(/(\d+)X$/);
  return m ? Number(m[1]) : 0;
}
