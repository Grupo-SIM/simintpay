import { money, type Platform } from './types';

type WithdrawalFees = NonNullable<Platform['withdrawalFees']>;

export function WithdrawalFeeCard({ fees }: { fees: WithdrawalFees }) {
  const lines = [
    ['Taxa de saque (R$)', money(fees.fixed)],
    [
      'Taxa de saque (%)',
      `${parseFloat((fees.percent * 100).toPrecision(10))}%`,
    ],
    ['Saque mínimo (R$)', money(fees.minimum)],
  ];
  return (
    <section
      aria-label="Saque"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <article
        aria-label="Saque"
        className="min-w-0 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-white/10 dark:bg-white/[0.02]"
      >
        <h3 className="mb-3 text-sm font-semibold">Saque</h3>
        <dl className="divide-y divide-zinc-200 text-xs dark:divide-white/10">
          {lines.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 py-1"
            >
              <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="m-0 shrink-0 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </section>
  );
}
