import { formatBRL } from '@/lib/utils';

export type WalletBucket = {
  key: string;
  kind: 'platform' | 'simintpay' | 'unidentified';
  tag: string | null;
  name: string;
  isActive: boolean | null;
  balanceCents: number;
  lockedCents: number;
  availableCents: number;
  periodReceivedCents: number;
  periodWithdrawnCents: number;
  pendingWithdrawalsCents: number;
};

export const money = (cents: number) => formatBRL(cents / 100);

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function PlatformBalanceCard({ bucket }: { bucket: WalletBucket }) {
  return (
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="min-w-0">
        <h3 className="truncate font-semibold">{bucket.name}</h3>
        {bucket.isActive === false && (
          <p className="text-xs text-zinc-500">Inativa</p>
        )}
      </div>
      <dl className="flex flex-col gap-2">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Saldo disponível para saque
          </dt>
          <dd className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {money(bucket.availableCents)}
          </dd>
        </div>
        <Stat label="Faturado" value={money(bucket.periodReceivedCents)} />
        <Stat label="Sacado" value={money(bucket.periodWithdrawnCents)} />
        <Stat
          label="Saque pendente"
          value={money(bucket.pendingWithdrawalsCents)}
        />
      </dl>
    </div>
  );
}
