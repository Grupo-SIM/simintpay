/**
 * Adquirentes de pagamento suportadas pela plataforma.
 *
 * A plataforma roda múltiplas adquirentes simultaneamente. Cada loja/tenant
 * escolhe qual usar (ver `getModuleAcquirer` em modules/module.registry.ts).
 * `DOM` é o padrão histórico — toda transação criada antes da introdução de
 * múltiplas adquirentes é tratada como DOM.
 */
export enum Acquirer {
  /** DOM Pagamentos — adquirente original (apiv3.dompagamentos.com.br). */
  DOM = 'DOM',
  /** Frendz — segunda adquirente (api.frendz.com.br/api/public/v1). */
  FRENDZ = 'FRENDZ',
}

/** Adquirente usada quando nenhuma está explicitamente configurada para a loja. */
export const DEFAULT_ACQUIRER = Acquirer.DOM;

/**
 * Normaliza um valor livre (env var, coluna do banco, query) para um Acquirer.
 * Retorna o default quando o valor é vazio ou desconhecido — nunca lança,
 * para que uma configuração inválida degrade para o comportamento atual (DOM)
 * em vez de derrubar o fluxo de pagamento.
 */
export function toAcquirer(value: string | null | undefined): Acquirer {
  if (!value) return DEFAULT_ACQUIRER;
  const normalized = value.trim().toUpperCase();
  return normalized in Acquirer
    ? (Acquirer as Record<string, Acquirer>)[normalized]
    : DEFAULT_ACQUIRER;
}
