'use client';

import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { ReportSkeleton } from '@/app/(dashboard)/relatorio/components/ReportSkeleton';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { affiliateLink } from '@/features/affiliates/affiliates';
import { getAffiliateReceipts } from '@/features/affiliates/affiliates.service';

const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
/** Visão somente leitura do afiliado: código, link, vendas e comissões. */
export function AffiliateReceipts({
  filters = {},
}: {
  filters?: Record<string, string | undefined>;
} = {}) {
  const { user } = useCurrentUser();
  const api = createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
  const query = useQuery({
    queryKey: ['affiliate-receipts', user?.id, filters],
    queryFn: () => getAffiliateReceipts(api, filters, 1),
    enabled: Boolean(user?.id && !user.isAdmin),
    retry: false,
  });
  if (!user || user.isAdmin) return null;
  if (
    query.isSuccess &&
    query.data.total === 0 &&
    !query.data.hasAffiliation &&
    !query.data.affiliations?.length
  )
    return null;
  return (
    <div
      role="region"
      className="flex flex-col gap-6"
      aria-label="Recebimentos de afiliado"
    >
      {query.isPending ? (
        <ReportSkeleton />
      ) : query.isError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Não foi possível carregar suas comissões de afiliado.{' '}
            {query.error.message}
          </p>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => void query.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <section
            aria-label="Afiliado"
            className="space-y-4 rounded-xl border border-zinc-200 p-4 dark:border-white/10"
          >
            <h2 className="text-base font-semibold">Afiliado</h2>
            {query.data.affiliations?.length ? (
              <ul className="space-y-2 text-sm">
                {query.data.affiliations.map((row) => (
                  <li
                    key={`${row.code}-${row.platformName ?? ''}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {row.platformName && <span>{row.platformName}:</span>}
                    <span>
                      Código <strong className="font-mono">{row.code}</strong>
                    </span>
                    <CopyButton
                      value={row.code}
                      label="Copiar código"
                      className="px-2 py-1 text-xs"
                    />
                    {row.linkBaseUrl && (
                      <CopyButton
                        value={affiliateLink(row.linkBaseUrl, row.code)}
                        label="Copiar link"
                        className="px-2 py-1 text-xs"
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <dl className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ['Vendas', String(query.data.total)],
                  ['Pendente', money(query.data.summary.lockedCents)],
                  ['Creditada', money(query.data.summary.creditedCents)],
                  ['Revertida', money(query.data.summary.reversedCents)],
                ] as const
              ).map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-zinc-200 p-3 dark:border-white/10"
                >
                  <dt className="text-sm text-zinc-500 dark:text-zinc-400">
                    {label}
                  </dt>
                  <dd className="text-lg font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Comissões creditadas já integram sua carteira. Somente leitura.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
