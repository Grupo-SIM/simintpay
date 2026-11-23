import {
  AffiliateConfirmationError,
  canonical,
} from '@/features/affiliates/affiliates.service';
import { parseAffiliates } from '@/features/affiliates/affiliates';
import type {
  AffiliateAgreement,
  AffiliateProduct,
  AffiliateSaveInput,
} from '@/features/affiliates/types';
import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';

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
  return parseAffiliates(response?.data);
}

export async function saveMarginAffiliates(
  api: ApiClient,
  product: AffiliateProduct,
  id: string,
  version: number,
  input: AffiliateSaveInput,
): Promise<AffiliateAgreement> {
  const { linkBaseUrl: _ignored, ...body } = input;
  const response = await api.put<{ data: unknown }>(
    endpoints.affiliates.marginConfiguration(product, id),
    { version, ...body },
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
    saved.defaultPercentageBps !== body.defaultPercentageBps ||
    saved.commissionOnRenewals !== body.commissionOnRenewals ||
    canonical(saved.affiliates) !== canonical(body.affiliates)
  )
    throw new AffiliateConfirmationError(
      'O servidor não confirmou os afiliados da margem salvos. Recarregue a configuração antes de tentar novamente.',
    );
  return saved;
}
