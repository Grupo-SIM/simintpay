import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { parseCoproduction } from './coproduction';
import type { Coproducer, CoproductionProduct } from './types';

export class CoproductionConfirmationError extends Error {}

export async function getCoproduction(
  api: ApiClient,
  product: CoproductionProduct,
  id: string,
) {
  const response = await api.get<{ data: unknown }>(
    endpoints.coproduction.configuration(product, id),
    { cache: 'no-store' },
  );
  return parseCoproduction(response?.data);
}

export async function saveCoproduction(
  api: ApiClient,
  product: CoproductionProduct,
  id: string,
  version: number,
  participants: Coproducer[],
  mode?: 'OWN' | 'INHERIT',
) {
  const response = await api.put<{ data: unknown }>(
    endpoints.coproduction.configuration(product, id),
    {
      basis: 'NET',
      version,
      ...(mode ? { mode } : {}),
      participants: participants.map(({ email, percentageBps }) => ({
        email,
        percentageBps,
      })),
    },
  );
  let saved;
  try {
    saved = parseCoproduction(response?.data);
  } catch {
    throw new CoproductionConfirmationError(
      'O servidor não confirmou a configuração salva. Recarregue antes de tentar novamente.',
    );
  }
  const canonical = (rows: Coproducer[]) =>
    JSON.stringify(
      rows
        .map((row) => ({
          email: row.email.trim().toLowerCase(),
          percentageBps: row.percentageBps,
        }))
        .sort((a, b) => a.email.localeCompare(b.email)),
    );
  if (
    saved.version <= version ||
    (mode && saved.mode !== mode) ||
    canonical(saved.participants) !== canonical(participants)
  ) {
    throw new CoproductionConfirmationError(
      'O servidor não confirmou as participações salvas. Recarregue a configuração antes de tentar novamente.',
    );
  }
  return saved;
}
