/**
 * Interface base de configuração de cada módulo/sistema.
 * Cada módulo define suas próprias taxas e regras de negócio.
 */
export interface ModuleConfig {
  /** Nome de exibição */
  name: string;

  /** Slug único — usado para lookup no banco */
  slug: string;

  /** Saque */
  saque: {
    /** Valor mínimo para solicitar saque (R$) */
    minValor: number;
    /** Taxa fixa por saque (R$) */
    taxaFixa: number;
    /** Taxa percentual por saque (0.02 = 2%). 0 se não houver. */
    taxaPercentual: number;
    /** Calcular o valor líquido recebido */
    calcularLiquido(valorBruto: number): number;
    /** Calcular a taxa total cobrada */
    calcularTaxa(valorBruto: number): number;
    /** Fator de liquidez do saldo disponível (ex: 0.91 = 91% do saldo bruto fica disponível p/ saque). */
    fatorLiquidez: number;
  };

  /** Taxas de processamento (MDR) por método de pagamento */
  mdr: {
    pix: number; // decimal sobre o bruto; padrão em keys (ex.: 0,02 = 2%)
    cartao: {
      [parcelas: number]: number; // ex: { 1: 0.0399, 2: 0.083, ... }
    };
    taxaFixaPorTransacao: number; // R$ fixo por transação (ex: 1.00)
    taxaCashback?: number; // Taxa de cashback em percentual (ex: 3.0 = 3%)
  };

  /** Limites gerais */
  limites: {
    /** Saldo máximo acumulado (R$). null = sem limite. */
    saldoMaximo: number | null;
    /** Valor máximo por saque (R$). null = sem limite. */
    saqueMaximo: number | null;
    /** Quantidade máxima de saques pendentes simultâneos */
    saquesPendentesMax: number;
  };
}
