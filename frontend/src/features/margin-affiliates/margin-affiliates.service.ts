import {
  AffiliateConfirmationError,
  canonical,
} from '@/features/affiliates/affiliates.service';
import type { AffiliateProduct } from '@/features/affiliates/types';
import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { parseMarginAgreement } from './margin-affiliates';
import type { MarginAgreement, MarginSaveInput } from './types';

export async function getMarginAffiliates(
  api: ApiClient,
  product: AffiliateProduct,
  id: string,
) {
  // Erro (inclusive 404/403) propaga: nunca vira acordo vazio.
  const response = await api.get<{ data: unknown }>(
    endpoints.affiliates.marginConfiguration(product, id),
    { cache: 'no-store' },
  );
  return parseMarginAgreement(response?.data);
}

export async function saveMarginAffiliates(
  api: ApiClient,
  product: AffiliateProduct,
  id: string,
  version: number,
  input: MarginSaveInput,
): Promise<MarginAgreement> {
  const response = await api.put<{ data: unknown }>(
    endpoints.affiliates.marginConfiguration(product, id),
    {
      version,
      defaultPercentageBps: input.defaultPercentageBps,
      commissionOnRenewals: input.commissionOnRenewals,
      affiliates: input.affiliates,
      coproducers: input.coproducers,
    },
  );
  let saved: MarginAgreement;
  try {
    saved = parseMarginAgreement(response?.data);
  } catch {
    throw new AffiliateConfirmationError(
      'O servidor não confirmou a configuração salva. Recarregue antes de tentar novamente.',
    );
  }
  if (
    saved.version <= version ||
    saved.defaultPercentageBps !== input.defaultPercentageBps ||
    saved.commissionOnRenewals !== input.commissionOnRenewals ||
    canonical(saved.affiliates) !== canonical(input.affiliates) ||
    canonical(saved.coproducers) !== canonical(input.coproducers)
  )
    throw new AffiliateConfirmationError(
      'O servidor não confirmou a margem salva. Recarregue a configuração antes de tentar novamente.',
    );
  return saved;
}
