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
};

export const money = (cents: number) => formatBRL(cents / 100);

const SUBTITLE: Record<WalletBucket['kind'], string | null> = {
  platform: null,
  simintpay: 'Margem e ganhos de afiliado',
  unidentified: 'Histórico sem plataforma',
};

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function PlatformBalanceCard({ bucket }: { bucket: WalletBucket }) {
  const subtitle =
    SUBTITLE[bucket.kind] ?? (bucket.isActive === false ? 'Inativa' : null);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
      <div className="min-w-0">
        <h3 className="truncate font-semibold">{bucket.name}</h3>
        {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Saldo</p>
        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
          {money(bucket.balanceCents)}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Disponível" value={money(bucket.availableCents)} />
        <Stat label="Bloqueado" value={money(bucket.lockedCents)} />
        <Stat label="Recebido" value={money(bucket.periodReceivedCents)} />
        <Stat label="Sacado" value={money(bucket.periodWithdrawnCents)} />
      </dl>
    </div>
  );
}
