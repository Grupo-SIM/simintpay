'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FinancialNumberField } from './FinancialNumberField';
import {
  defaultOwner,
  formatCents,
  type Lane,
  type OwnerRule,
  type RowState,
} from './financial-types';

export function FinancialSimulationCard({
  rowKey,
  rule,
  lane,
  state,
  admin,
  credit,
  onChange,
  onValidityChange,
  onEditContract,
}: {
  rowKey: string;
  rule?: OwnerRule;
  lane?: Lane;
  state?: RowState;
  admin: boolean;
  credit: boolean;
  onChange: (rule: OwnerRule) => void;
  onValidityChange: (name: string, valid: boolean) => void;
  onEditContract: () => void;
}) {
  const owner = rule ?? { ...defaultOwner(), passInterestPpm: 1_000_000 },
    result = state?.result;
  const differenceCents = result
    ? result.netCents - result.originalCents
    : undefined;
  const pct = (ppm: number) =>
    `${(ppm / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  const metrics: { label: string; value?: number; rate?: boolean }[] = [
    { label: 'Total comprador', value: result?.buyerTotalCents },
    { label: 'Custos SimIntPay', value: result?.processingCostCents },
    ...(credit
      ? [
          {
            label: 'Juros pagos pelo cliente',
            value: result?.buyerInterestCents,
          },
          {
            label: 'Taxa de juros definida (SimIntPay)',
            value: result?.interestRatePpm,
            rate: true,
          },
          {
            label: 'Taxa de juros repassada (cliente)',
            value: result?.buyerInterestRatePpm,
            rate: true,
          },
        ]
      : []),
  ];
  const simRule = lane ? (lane.total ?? lane.sim) : undefined;
  const contractRows: [string, string, string][] =
    lane && simRule
      ? [
          [
            'Fixo',
            formatCents(lane.contract.fixedCents),
            formatCents(simRule.fixedCents),
          ],
          ['Percentual', pct(lane.contract.ratePpm), pct(simRule.ratePpm)],
          ...(credit
            ? [
                [
                  'Juros',
                  pct(lane.contract.interestPpm),
                  pct(lane.sim.interestPpm),
                ] as [string, string, string],
              ]
            : []),
        ]
      : [];
  const format = (value?: number, rate?: boolean) =>
    value === undefined ? '—' : rate ? pct(value) : formatCents(value);
  const skeleton = (
    <span
      aria-label="Calculando"
      className="inline-block h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-white/10"
    />
  );
  return (
    <article
      aria-label={
        credit ? `Parcela ${rowKey.split('/')[3]}x` : 'Resumo da simulação'
      }
      aria-busy={state?.pending}
      className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {credit ? `${rowKey.split('/')[3]}x` : 'Resumo'}
        </h3>
        {admin && (
          <Button
            variant="outline"
            type="button"
            size="sm"
            className="cursor-pointer"
            onClick={onEditContract}
          >
            <Pencil />
            Editar taxas
          </Button>
        )}
      </div>
      {credit && !admin && (
        <div className="mb-3">
          <FinancialNumberField
            name={`${rowKey}-passInterestPpm`}
            label="Repassar juros (%)"
            rate
            value={owner.passInterestPpm}
            onValidityChange={onValidityChange}
            onChange={(passInterestPpm) =>
              onChange({ ...owner, passInterestPpm })
            }
          />
        </div>
      )}
      {admin && lane && (
        <table className="mb-3 w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="pb-1 font-normal">
                <span className="sr-only">Taxa</span>
              </th>
              <th scope="col" className="pb-1 text-right font-normal">
                Custo adquirente
              </th>
              <th
                scope="col"
                className="pb-1 text-right font-normal"
                title={lane.total ? 'Inclui o custo da adquirente' : undefined}
              >
                {lane.total ? 'Total definido' : 'SimIntPay'}
              </th>
            </tr>
          </thead>
          <tbody>
            {contractRows.map(([label, acquirer, sim]) => (
              <tr
                key={label}
                className="border-t border-zinc-200 dark:border-white/10"
              >
                <th
                  scope="row"
                  className="py-1 text-left font-normal text-zinc-500 dark:text-zinc-400"
                >
                  {label}
                </th>
                <td className="py-1 text-right">{acquirer}</td>
                <td className="py-1 text-right font-medium">{sim}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Líquido
          </div>
          <div className="text-base font-semibold tabular-nums">
            {state?.pending ? skeleton : format(result?.netCents)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Diferença
          </div>
          <div
            className={`text-base font-semibold tabular-nums ${differenceCents !== undefined && differenceCents < 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}
          >
            {state?.pending ? skeleton : format(differenceCents)}
          </div>
        </div>
      </div>
      <dl className="divide-y divide-zinc-200 text-xs dark:divide-white/10">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex items-baseline justify-between gap-3 py-1"
          >
            <dt className="text-zinc-500 dark:text-zinc-400">{metric.label}</dt>
            <dd className="m-0 shrink-0 tabular-nums">
              {state?.pending ? skeleton : format(metric.value, metric.rate)}
            </dd>
          </div>
        ))}
      </dl>
      {admin && !lane && !state?.pending && (
        <p className="mt-3 text-xs text-amber-600">Taxas não configuradas</p>
      )}
      {admin && result && !state?.pending && (
        <details className="group mt-3 border-t pt-2 text-xs">
          <summary className="cursor-pointer font-medium">
            Composição <span className="group-open:hidden">· Expandir</span>
            <span className="hidden group-open:inline">· Minimizar</span>
          </summary>
          <dl className="mt-2 space-y-1">
            {[
              ['Adquirente', result.acquirerProcessingCents],
              ['Adicional SimIntPay', result.simAdditionCents],
              ['Juros adquirente', result.acquirerInterestCents],
              ['Adicional de juros', result.simInterestCents],
              ['Margem SimIntPay', result.simMarginCents],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt>{label}</dt>
                <dd className="m-0 tabular-nums">
                  {formatCents(Number(value ?? 0))}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </article>
  );
}
