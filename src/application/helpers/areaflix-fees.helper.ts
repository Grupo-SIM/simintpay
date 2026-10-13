import { getPlatformTaxaEffective } from '../../modules/platform-taxas/platform-taxas.store';
import {
  PLATFORM_TAXA_DEFAULTS,
  type PlataformaTaxaKey,
} from '../../modules/platform-taxas/platform-taxas.keys';

export type AreaflixPaymentMethod = 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD';

/** Identifica link da plataforma AREAFLIX (tag explícita, plataformas[] ou webhookUrl). */
export function isAreaflixLink(input: {
  webhookUrl?: string | null;
  platformTag?: string | null;
  plataformas?: string[] | null;
}): boolean {
  if ((input.platformTag ?? '').toUpperCase() === 'AREAFLIX') return true;
  if ((input.plataformas ?? []).some((p) => (p ?? '').toUpperCase() === 'AREAFLIX')) return true;
  return false;
}

/**
 * Líquido do vendedor areaflix: valor − % do método de pagamento − taxa fixa.
 * Usa exatamente as taxas configuradas pelo admin no painel (plataforma AREAFLIX):
 * - PIX: LIQUIDEZ (fator; ex. 0,91 = taxa 9%) + TAXA_SERVICO (fixa)
 * - Cartão 1x: TAXA_LINK_PERCENT + TAXA_LINK_FIXA
 * - Cartão Nx: MDR_LINK_{N}X + TAXA_LINK_FIXA
 * - Débito: TAXA_DEBITO_PERCENT + TAXA_DEBITO_FIXA
 */
export function calculateAreaflixSellerNet(
  gross: number,
  method: AreaflixPaymentMethod,
  installments = 1,
): number {
  const taxa = (key: PlataformaTaxaKey) =>
    getPlatformTaxaEffective('AREAFLIX', key, PLATFORM_TAXA_DEFAULTS[key]);

  let net: number;

  if (method === 'PIX') {
    const liquidez = taxa('LIQUIDEZ');
    const fixa = taxa('TAXA_SERVICO');
    net = gross * liquidez - fixa;
  } else if (method === 'DEBIT_CARD') {
    const percent = taxa('TAXA_DEBITO_PERCENT');
    const fixa = taxa('TAXA_DEBITO_FIXA');
    net = gross * (1 - percent) - fixa;
  } else {
    const n = Math.min(Math.max(1, Math.trunc(installments || 1)), 12);
    const percent =
      n <= 1
        ? taxa('TAXA_LINK_PERCENT')
        : taxa(`LINK_COST_${n}X` as PlataformaTaxaKey);
    const fixa = taxa('TAXA_LINK_FIXA');
    net = gross * (1 - percent) - fixa;
  }

  return Math.round(net * 100) / 100;
}
