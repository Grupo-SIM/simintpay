'use client';

import { Info, Banknote, Gift, Shield } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { Spinner } from '@/components/ui/Loading';

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

export default function ConfigTaxasPage() {
  const { data: taxasRaw, isLoading } = useQuery({
    queryKey: ['configuracoes', 'taxas'],
    queryFn: () =>
      makeApi().get<{
        plataforma?: {
          taxaServico: number;
          taxaFixaTransacao: number;
          taxaCashback: number;
        };
        data?: {
          plataforma?: {
            taxaServico: number;
            taxaFixaTransacao: number;
            taxaCashback: number;
          };
        };
      }>(endpoints.configuracoes.taxas),
  });

  const plataforma = taxasRaw?.data?.plataforma ?? taxasRaw?.plataforma;

  const taxaServico: number = plataforma?.taxaServico ?? 4;
  const taxaFixaTransacao: number = plataforma?.taxaFixaTransacao ?? 1;
  const taxaCashback: number = plataforma?.taxaCashback ?? 3;
  const totalFixo = taxaFixaTransacao + taxaCashback;

  return (
    <div className="flex flex-col gap-6 p-1">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Configurações • Taxas
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Taxas e custos aplicados às suas transações.
        </p>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner size={28} className="text-violet-400" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Taxas Fixas Operacionais */}
          <div className="overflow-hidden rounded-3xl border border-white/40 bg-white/70 p-6 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                <Banknote className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Taxas Fixas Operacionais
              </h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/50">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Taxa por Transação
                  </span>
                  <span className="text-xs text-zinc-500">
                    Cobrada em todas as vendas (Pix, Débito, Crédito, Link)
                  </span>
                </div>
                <span className="text-lg font-bold text-violet-600 dark:text-violet-400 text-right">
                  R$ {fmtBrl(taxaFixaTransacao)}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/50">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    Taxa de Cashback Fixo
                  </span>
                  <span className="text-xs text-zinc-500">
                    Dedução obrigatória por transação realizada
                  </span>
                </div>
                <span className="text-lg font-bold text-violet-600 dark:text-violet-400 text-right">
                  R$ {fmtBrl(taxaCashback)}
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs leading-relaxed">
                <strong>Importante:</strong> Estas taxas são fixas e aplicadas
                individualmente a cada transação, independentemente do valor
                total da venda ou do método de pagamento utilizado.
              </p>
            </div>
          </div>

          {/* Resumo de Deduções */}
          <div className="flex flex-col gap-6">
            <div className="overflow-hidden rounded-3xl border border-white/40 bg-white/70 p-6 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.45)] backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <Gift className="h-5 w-5" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Resumo de Deduções
                </h2>
              </div>

              <div className="flex flex-col items-center justify-center py-4 text-center">
                <div className="mb-2 text-4xl font-black text-zinc-900 dark:text-zinc-100">
                  R$ {fmtBrl(totalFixo)}
                </div>
                <p className="text-sm text-zinc-500">
                  Total de taxas fixas por transação
                </p>
                <div className="mt-6 h-1 w-24 rounded-full bg-linear-to-r from-violet-500 to-emerald-500" />
              </div>

              <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
                O valor líquido das suas vendas será calculado subtraindo o MDR
                (%) + R$ {fmtBrl(totalFixo)} do valor bruto.
              </p>
            </div>

            {/* Taxa de Transação Sim Int Pay */}
            <div className="overflow-hidden rounded-3xl border border-violet-500/20 bg-violet-50/50 p-6 shadow-[0_16px_44px_-24px_rgba(15,23,42,0.25)] backdrop-blur-xl dark:border-violet-500/15 dark:bg-violet-500/5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        Taxa de Transação
                      </h2>
                      <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-500 dark:text-violet-400">
                        Sim Int Pay
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-2xl font-black text-violet-600 dark:text-violet-400">
                  R$ {fmtBrl(taxaServico)}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Taxa fixa cobrada em todos os repasses. Cobre os custos
                operacionais de cashback (R${fmtBrl(taxaCashback)}) e
                processamento (R${fmtBrl(taxaFixaTransacao)}) por transação.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
