'use client';

import { useState } from 'react';
import { FileText, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FinancialNumberField } from './FinancialNumberField';
import {
  defaultOwner,
  effectiveFee,
  feeShortfall,
  formatCents,
  formatPpm,
  laneId,
  type AdditiveTotals,
  type FeeMode,
  type Lane,
  type OwnerRule,
  type RowState,
} from './financial-types';

export function FinancialSimulationCard({
  rowKey,
  title,
  enabled = true,
  onToggle,
  rule,
  lane,
  feeMode,
  additiveTotals,
  state,
  admin,
  credit,
  onChange,
  onValidityChange,
  onEditContract,
}: {
  rowKey: string;
  title: string;
  /** Lane accepted by the platform; disabled lanes are greyed out. */
  enabled?: boolean;
  /** Absent when the configuration has no acceptance list (GLOBAL). */
  onToggle?: (enabled: boolean) => void;
  rule?: OwnerRule;
  lane?: Lane;
  feeMode?: FeeMode | null;
  additiveTotals?: AdditiveTotals;
  state?: RowState;
  admin: boolean;
  credit: boolean;
  onChange: (rule: OwnerRule) => void;
  onValidityChange: (name: string, valid: boolean) => void;
  onEditContract: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const owner = rule ?? { ...defaultOwner(), passInterestPpm: 1_000_000 },
    result = state?.result;
  const pct = (ppm: number) =>
    `${(ppm / 10_000).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}%`;
  const noInterest =
    !!result &&
    result.buyerInterestCents === 0 &&
    result.interestRatePpm === 0 &&
    result.buyerInterestRatePpm === 0;
  const showInterest = credit && !(admin && noInterest);
  const additiveCents =
    result && feeMode && feeMode !== 'SIMINTPAY_ONLY'
      ? [additiveTotals?.order, additiveTotals?.product].reduce(
          (sum, scope) =>
            sum +
            Math.round(
              (result.originalCents * (scope?.percentageValue ?? 0)) / 10_000,
            ) +
            (scope?.fixedValue ?? 0),
          0,
        )
      : result
        ? 0
        : undefined;
  const buyerTotalCents = result
    ? result.originalCents + result.buyerInterestCents + (additiveCents ?? 0)
    : undefined;
  const sellerNetCents =
    result && buyerTotalCents !== undefined
      ? buyerTotalCents - result.contractedCostCents
      : undefined;
  const profitCents = admin ? result?.simMarginCents : sellerNetCents;
  const lines: {
    label: string;
    value?: number;
    /** Effective percentage of the base amount, shown next to the label. */
    percent?: string;
    strong?: boolean;
    sign?: '+' | '-';
  }[] = [
    { label: 'Valor base', value: result?.originalCents },
    ...(admin
      ? [
          {
            label: 'Custos da adquirente',
            value: result
              ? (result.acquirerProcessingCents ??
                (result.acquirerCostCents ?? 0) -
                  (result.acquirerInterestCents ?? 0))
              : undefined,
            sign: '-' as const,
          },
          {
            label: 'Adicional SimIntPay',
            value: result?.simAdditionCents ?? (result ? 0 : undefined),
            sign: '-' as const,
          },
          ...(showInterest
            ? [{ label: 'Juros do cliente', value: result?.buyerInterestCents }]
            : []),
          ...(showInterest
            ? [
                {
                  label: 'Juros da adquirente',
                  value: result?.acquirerInterestCents ?? 0,
                  sign: '-' as const,
                },
                {
                  label: 'Juros SimIntPay',
                  value: result?.simInterestCents ?? (result ? 0 : undefined),
                  sign: '-' as const,
                },
              ]
            : []),
        ]
      : [
          {
            label: 'Custos SimIntPay',
            value: result?.contractedCostCents,
            percent:
              result && result.originalCents > 0
                ? `${((result.contractedCostCents / result.originalCents) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
                : undefined,
            sign: '-' as const,
          },
        ]),
    ...(!admin && showInterest
      ? [{ label: 'Juros do cliente', value: result?.buyerInterestCents }]
      : []),
    ...(additiveCents
      ? [{ label: 'Taxas aditivas', value: additiveCents, sign: '+' as const }]
      : []),
    { label: 'Vendedor recebe', value: sellerNetCents, strong: true },
  ];
  const displayedContract = result?.effectiveFees
    ? result.effectiveFees.acquirer
    : lane?.contract;
  const simRule =
    result?.effectiveFees?.sim ??
    (lane ? { ...lane.sim, ...(lane.total ?? {}) } : undefined);
  const contractRows: [string, string, string][] =
    displayedContract && simRule
      ? [
          [
            'Fixo',
            formatCents(displayedContract.fixedCents),
            formatCents(simRule.fixedCents),
          ],
          ['Percentual', pct(displayedContract.ratePpm), pct(simRule.ratePpm)],
          ...(showInterest
            ? [
                [
                  'Juros',
                  pct(displayedContract.interestPpm),
                  pct(
                    result?.effectiveFees?.sim.interestPpm ??
                      lane!.sim.interestPpm,
                  ),
                ] as [string, string, string],
              ]
            : []),
        ]
      : [];
  const effective = lane
    ? effectiveFee(
        {
          ...lane,
          sim: simRule
            ? {
                ...simRule,
                interestPpm: simRule.interestPpm ?? lane.sim.interestPpm,
              }
            : lane.sim,
        },
        feeMode,
        additiveTotals,
      )
    : undefined;
  const shortfall =
    displayedContract && effective
      ? feeShortfall(effective, displayedContract)
      : undefined;
  const short =
    !!shortfall &&
    (shortfall.rateShortfallPpm > 0 || shortfall.fixedShortfallCents > 0);
  const effectiveLabel = effective
    ? effective.fixedCents > 0
      ? `${formatPpm(effective.ratePpm)} + ${formatCents(effective.fixedCents)}`
      : formatPpm(effective.ratePpm)
    : '—';
  const format = (value?: number) =>
    value === undefined ? '—' : formatCents(value);
  const skeleton = (
    <span
      aria-label="Calculando"
      className="inline-block h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-white/10"
    />
  );
  const breakdown = (
    <dl className="divide-y divide-zinc-200 text-xs dark:divide-white/10">
      {lines
        .filter((line) => admin || !line.strong)
        .map((line) => (
          <div
            key={line.label}
            className={`flex items-baseline justify-between gap-3 py-1 ${line.strong ? 'font-semibold' : ''}`}
          >
            <dt
              className={line.strong ? '' : 'text-zinc-500 dark:text-zinc-400'}
            >
              {line.label}
            </dt>
            <dd className="m-0 shrink-0 tabular-nums">
              {state?.pending ? (
                skeleton
              ) : (
                <>
                  {line.sign && line.value ? `${line.sign} ` : ''}
                  {format(line.value)}
                </>
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
  return (
    <article
      aria-label={title}
      aria-busy={state?.pending}
      className={`${credit && !admin ? 'row-span-4' : 'row-span-3'} grid min-w-0 grid-rows-subgrid gap-y-0 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 transition-opacity dark:border-white/10 dark:bg-white/[0.02] ${enabled ? '' : 'opacity-50 grayscale'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          {onToggle && (
            <input
              type="checkbox"
              name={`accepted-${laneId(rowKey)}`}
              aria-label={`Aceitar ${title}`}
              checked={enabled}
              onChange={(event) => onToggle(event.currentTarget.checked)}
            />
          )}
          <h3>{title}</h3>
        </label>
        <div className="flex items-center gap-2">
          {admin && (
            <>
              <Button
                variant="outline"
                type="button"
                size="sm"
                disabled={!enabled}
                className="cursor-pointer"
                onClick={() => setDetailsOpen(true)}
              >
                <FileText />
                Detalhes
              </Button>
              <Button
                variant="outline"
                type="button"
                size="sm"
                disabled={!enabled}
                className="cursor-pointer"
                onClick={onEditContract}
              >
                <Pencil />
                Editar taxas
              </Button>
            </>
          )}
        </div>
      </div>
      {credit && !admin && (
        <div className="mb-3">
          <FinancialNumberField
            name={`${rowKey}-passInterestPpm`}
            label="Repassar juros (%)"
            disabled={!enabled}
            rate
            value={owner.passInterestPpm}
            onValidityChange={onValidityChange}
            onChange={(passInterestPpm) =>
              onChange({ ...owner, passInterestPpm })
            }
          />
        </div>
      )}
      <div className="mb-3">
        {!admin && breakdown}
        {admin && lane && (
          <table className="mb-3 w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left text-zinc-500 dark:text-zinc-400">
                <th scope="col" className="pb-1 font-normal">
                  <span className="sr-only">Taxa</span>
                </th>
                <th scope="col" className="pb-1 text-right font-normal">
                  Adquirente
                </th>
                <th
                  scope="col"
                  className="pb-1 text-right font-normal"
                  title="Adicional ao custo da adquirente"
                >
                  SimIntPay
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
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Cliente paga
          </div>
          <div className="text-base font-semibold tabular-nums">
            {state?.pending ? skeleton : format(buyerTotalCents)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {admin ? 'Margem líquida' : 'Lucro bruto'}
          </div>
          <div
            className={`text-base font-semibold tabular-nums ${profitCents !== undefined && profitCents < 0 ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}
          >
            {state?.pending ? skeleton : format(profitCents)}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-100 p-2 dark:bg-white/5">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Taxa efetiva
          </div>
          <div className="text-base font-semibold tabular-nums">
            {state?.pending ? skeleton : effectiveLabel}
          </div>
        </div>
        {admin && !lane && !state?.pending && (
          <p className="col-span-2 text-xs text-amber-600">
            Taxas não configuradas
          </p>
        )}
      </div>
      {admin && (
        <Modal
          open={detailsOpen}
          title={`Detalhes — ${title}`}
          maxWidth="max-w-md"
          onClose={() => setDetailsOpen(false)}
        >
          <div>
            {admin && effective && shortfall && lane && (
              <div
                className={`mb-3 rounded-lg border p-2 text-xs ${short ? 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-300' : 'border-zinc-200 text-zinc-600 dark:border-white/10 dark:text-zinc-300'}`}
              >
                <div className="flex justify-between gap-2">
                  <span>Taxa efetiva do lojista</span>
                  <span className="font-medium tabular-nums">
                    {formatPpm(effective.ratePpm)} +{' '}
                    {formatCents(effective.fixedCents)}
                  </span>
                </div>
                <div
                  role={short ? 'alert' : undefined}
                  className={`mt-1 ${short ? 'font-medium' : ''}`}
                >
                  {short
                    ? `Cobertura insuficiente${
                        shortfall.rateShortfallPpm > 0
                          ? `: faltam ${formatPpm(shortfall.rateShortfallPpm)}`
                          : ''
                      }${
                        shortfall.fixedShortfallCents > 0
                          ? `${shortfall.rateShortfallPpm > 0 ? ' e' : ': faltam'} ${formatCents(shortfall.fixedShortfallCents)}`
                          : ''
                      } sobre o custo da adquirente`
                    : 'Cobre o custo da adquirente'}
                </div>
              </div>
            )}
            <div>{breakdown}</div>
          </div>
        </Modal>
      )}
    </article>
  );
}
