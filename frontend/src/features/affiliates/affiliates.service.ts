import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { parseAffiliates } from './affiliates';
import type {
  AffiliateAgreement,
  AffiliateProduct,
  AffiliateReceipts,
  AffiliateSaveInput,
} from './types';

export class AffiliateConfirmationError extends Error {}

/** Mesmos filtros do relatório e de GET /coproducao/recebimentos. */
export type AffiliateReceiptFilters = {
  startDate?: string;
  endDate?: string;
  platform?: string;
  paymentMethod?: string;
};

export function getAffiliateReceipts(
  api: ApiClient,
  filters: AffiliateReceiptFilters = {},
  page = 1,
) {
  const { startDate, endDate, platform, paymentMethod } = filters;
  return api.get<AffiliateReceipts>(endpoints.affiliates.receipts, {
    query: { startDate, endDate, platform, paymentMethod, page },
    cache: 'no-store',
  });
}

export async function getAffiliates(
  api: ApiClient,
  product: AffiliateProduct,
  id: string,
) {
  // Erro (inclusive 404) propaga: nunca vira acordo vazio.
  const response = await api.get<{ data: unknown }>(
    endpoints.affiliates.configuration(product, id),
    { cache: 'no-store' },
  );
  return parseAffiliates(response?.data);
}

export const canonical = (
  rows: { email: string; percentageBps: number | null }[],
) =>
  JSON.stringify(
    rows
      .map((row) => ({
        email: row.email.trim().toLowerCase(),
        percentageBps: row.percentageBps ?? null,
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  );

export async function saveAffiliates(
  api: ApiClient,
  product: AffiliateProduct,
  id: string,
  version: number,
  input: AffiliateSaveInput,
): Promise<AffiliateAgreement> {
  const response = await api.put<{ data: unknown }>(
    endpoints.affiliates.configuration(product, id),
    { version, ...input },
  );
  let saved: AffiliateAgreement;
  try {
    saved = parseAffiliates(response?.data);
  } catch {
    throw new AffiliateConfirmationError(
      'O servidor não confirmou a configuração salva. Recarregue antes de tentar novamente.',
    );
  }
  if (
    saved.version <= version ||
    saved.defaultPercentageBps !== input.defaultPercentageBps ||
    saved.commissionOnRenewals !== input.commissionOnRenewals ||
    canonical(saved.affiliates) !== canonical(input.affiliates)
  )
    throw new AffiliateConfirmationError(
      'O servidor não confirmou os afiliados salvos. Recarregue a configuração antes de tentar novamente.',
    );
  return saved;
}
