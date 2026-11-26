import { money, Stat } from './PlatformBalanceCard';

export type BalanceTotals = {
  availableCents: number;
  receivedCents: number;
  withdrawnCents: number;
  pendingWithdrawalsCents: number;
};

function TotalCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail?: string;
  tone: string;
}) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      <p className="min-h-4 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}

/** Saldo, Faturado and Saque, accumulated over everything (never filtered by period). */
export function BalanceTotalCards({ totals }: { totals: BalanceTotals }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TotalCard
        label="Saldo disponível para saque"
        value={money(totals.availableCents)}
        tone="text-emerald-600 dark:text-emerald-400"
      />
      <TotalCard
        label="Faturado"
        value={money(totals.receivedCents)}
        tone="text-sky-600 dark:text-sky-400"
      />
      <TotalCard
        label="Saque"
        value={money(totals.withdrawnCents)}
        detail={`Pendente: ${money(totals.pendingWithdrawalsCents)}`}
        tone="text-amber-600 dark:text-amber-400"
      />
    </div>
  );
}

export { Stat };
