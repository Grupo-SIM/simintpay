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
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

/** Faturado (period) beside Saque (withdrawn + pending), the same pair in every balance card. */
export function FiguresRow({
  billedCents,
  withdrawalCents,
}: {
  billedCents: number;
  withdrawalCents: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Stat label="Faturado" value={money(billedCents)} />
      <Stat label="Saque" value={money(withdrawalCents)} />
    </div>
  );
}

/** Saldo disponível, then Faturado beside Saque; one layout for users, platforms and buckets. */
export function BalanceCard({
  title,
  subtitle,
  availableCents,
  billedCents,
  withdrawalCents,
  onClick,
}: {
  title: string;
  subtitle?: string | null;
  availableCents: number;
  billedCents: number;
  withdrawalCents: number;
  onClick?: () => void;
}) {
  const className =
    'flex flex-col justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm dark:border-white/10 dark:bg-white/5' +
    (onClick
      ? ' cursor-pointer transition hover:border-gray-300 hover:shadow-md'
      : '');
  const body = (
    <>
      <div className="min-w-0">
        <h3 className="truncate font-semibold">{title}</h3>
        {subtitle && (
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        )}
      </div>
      <dl className="flex flex-col gap-3">
        <div>
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">
            Saldo disponível para saque
          </dt>
          <dd className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {money(availableCents)}
          </dd>
        </div>
        <FiguresRow
          billedCents={billedCents}
          withdrawalCents={withdrawalCents}
        />
      </dl>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function PlatformBalanceCard({ bucket }: { bucket: WalletBucket }) {
  return (
    <BalanceCard
      title={bucket.name}
      subtitle={bucket.isActive === false ? 'Inativa' : null}
      availableCents={bucket.availableCents}
      billedCents={bucket.periodReceivedCents}
      withdrawalCents={
        bucket.periodWithdrawnCents + bucket.pendingWithdrawalsCents
      }
    />
  );
}
