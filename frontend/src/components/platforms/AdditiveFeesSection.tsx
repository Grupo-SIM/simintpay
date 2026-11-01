import {
  formatFeeValue,
  SCOPE_LABELS,
  type AdditiveValue,
} from './financial-types';

/** Read-only list of the additive values SIM Delivery sent for this platform. */
export function AdditiveFeesSection({ fees }: { fees: AdditiveValue[] }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxas adicionais</legend>
      <ul className="divide-y divide-zinc-200 dark:divide-white/10">
        {fees.length === 0 && (
          <li className="py-2 text-sm text-zinc-500">
            Nenhuma taxa adicional enviada pelo SIM Delivery.
          </li>
        )}
        {fees.map((fee) => (
          <li key={fee.externalId} className="py-2 text-sm">
            <span className="font-medium">{fee.name}</span>
            <span className="ml-2 text-xs text-zinc-500">
              {SCOPE_LABELS[fee.applicationScope]} ·{' '}
              {formatFeeValue(fee.percentageValue, fee.fixedValue)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-zinc-500">Gerenciadas no SIM Delivery.</p>
    </fieldset>
  );
}
