'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CreditCard,
  Landmark,
  Repeat,
  ArrowDownToLine,
  Layers,
  BadgeCheck,
  Info,
} from 'lucide-react';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { Spinner } from '@/components/ui/Loading';
import {
  PLATAFORMA_TAXA_LABELS,
  PLATAFORMA_TAXA_DESCRIPTIONS,
  PLATAFORMA_TAXA_FIXED_BRL,
  taxaToDisplay,
  type PlataformaTaxaKey,
} from '@/features/platform-taxas/taxa-fields';

type MinhasTaxas = {
  email: string;
  platform: string;
  data: Partial<Record<PlataformaTaxaKey, number>>;
};

function makeApi() {
  return createApiClient({
    baseUrl: getDefaultApiBaseUrl(),
    getToken: () => localStorage.getItem('access_token'),
  });
}

function fmtBrl(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Formata uma taxa para exibição (% ou R$), usando os helpers canônicos. */
function fmtTaxa(key: PlataformaTaxaKey, value: number): string {
  if (value == null || Number.isNaN(value)) return '—';
  // TAXA_ASSINATURA é armazenada como percentual inteiro (ex.: 9.0 = 9%).
  if (key === 'TAXA_ASSINATURA')
    return `${parseFloat(Number(value).toPrecision(10))}%`;
  if (PLATAFORMA_TAXA_FIXED_BRL.has(key)) return `R$ ${fmtBrl(value)}`;
  return `${taxaToDisplay(key, value)}%`;
}

type Group = {
  id: string;
  title: string;
  icon: React.ElementType;
  keys: PlataformaTaxaKey[];
};

const GROUPS: Group[] = [
  {
    id: 'credito',
    title: 'Cartão de crédito',
    icon: CreditCard,
    keys: ['TAXA_LINK_PERCENT', 'TAXA_LINK_FIXA'],
  },
  {
    id: 'debito',
    title: 'Cartão de débito',
    icon: CreditCard,
    keys: ['TAXA_DEBITO_PERCENT', 'TAXA_DEBITO_FIXA'],
  },
  {
    id: 'pix',
    title: 'PIX e transação',
    icon: Landmark,
    keys: ['LIQUIDEZ', 'TAXA_SERVICO'],
  },
  {
    id: 'assinatura',
    title: 'Link de assinatura',
    icon: Repeat,
    keys: ['TAXA_ASSINATURA'],
  },
  {
    id: 'saque',
    title: 'Saque',
    icon: ArrowDownToLine,
    keys: ['TAXA_SAQUE_EXTRA', 'TAXA_SAQUE_PERCENT', 'SAQUE_MIN'],
  },
];

const PARCELAS_KEYS: PlataformaTaxaKey[] = [
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
];

const cardClass =
  'overflow-hidden rounded-3xl border border-white/40 bg-white/70 p-6 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5';

export default function TaxasClientePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['minhas-taxas'],
    queryFn: () =>
      makeApi().get<MinhasTaxas>(endpoints.admin.plataformas.minhasTaxas),
  });

  return (
    <div className="flex flex-col gap-6 p-1">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Taxas
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Estas são as taxas aplicadas à sua conta. Elas são definidas pela Sim
          Int Pay e não podem ser editadas aqui.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size={28} className="text-violet-400" />
        </div>
      ) : isError || !data ? (
        <div className={cardClass}>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Não foi possível carregar suas taxas no momento. Tente novamente
            mais tarde.
          </p>
        </div>
      ) : (
        <>
          {/* Resumo */}
          <div className={`${cardClass} flex flex-wrap items-center gap-3`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                <BadgeCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {data.platform}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {data.email}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.id} className={cardClass}>
                  <div className="mb-5 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                      {group.title}
                    </h2>
                  </div>

                  <div className="space-y-3">
                    {group.keys.map((key) => {
                      const value = data.data[key];
                      return (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/50"
                        >
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                              {PLATAFORMA_TAXA_LABELS[key]}
                              {PLATAFORMA_TAXA_DESCRIPTIONS[key] && (
                                <span
                                  title={PLATAFORMA_TAXA_DESCRIPTIONS[key]}
                                  className="cursor-help text-zinc-400"
                                >
                                  <Info className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-base font-bold text-zinc-900 dark:text-zinc-100">
                            {value == null ? '—' : fmtTaxa(key, value)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Parcelamento no cartão (link de pagamento) */}
          <div className={cardClass}>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Parcelamento no cartão
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Taxa por número de parcelas nos links de pagamento.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {PARCELAS_KEYS.map((key) => {
                const value = data.data[key];
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/50"
                  >
                    <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      {PLATAFORMA_TAXA_LABELS[key]}
                    </span>
                    <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {value == null ? '—' : fmtTaxa(key, value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
