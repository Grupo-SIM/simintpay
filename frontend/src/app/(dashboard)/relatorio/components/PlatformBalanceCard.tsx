import { formatBRL } from '@/lib/utils';

export type PlatformBalance = {
  id: string;
  tag: string;
  name: string;
  isActive: boolean;
  owner: { id: string; name: string; email?: string };
  periodEarnedCents: number;
  periodWithdrawnGrossCents: number;
  pendingWithdrawalsGrossCents: number;
  balanceCents: number;
  availableBalanceCents: number;
  ownerWalletBalanceCents: number;
};

export const money = (cents: number) => formatBRL(cents / 100);

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function PlatformBalanceCard({
  platform,
}: {
  platform: PlatformBalance;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate font-semibold">{platform.name}</h3>
        {!platform.isActive && (
          <span className="text-xs text-zinc-400">inativa</span>
        )}
      </div>
      <div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Saldo</p>
        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          {money(platform.balanceCents)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Stat
          label="Disponível"
          value={money(platform.availableBalanceCents)}
        />
        <Stat
          label="Saque pendente"
          value={money(platform.pendingWithdrawalsGrossCents)}
        />
        <Stat label="Faturado" value={money(platform.periodEarnedCents)} />
        <Stat
          label="Sacado"
          value={money(platform.periodWithdrawnGrossCents)}
        />
      </dl>
    </div>
  );
}
