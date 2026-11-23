import { formatPercentage } from '@/features/coproduction/coproduction';

/** Limite próprio da margem: independe do total conjunto de coprodutores e afiliados. */
export function MarginAffiliateIndicator({ bps }: { bps: number }) {
  const exceeds = bps > 10000;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Margem SimIntPay"
      data-over={exceeds}
      className={`space-y-1 border-b px-6 py-3 text-sm ${
        exceeds
          ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
          : 'border-zinc-200 bg-[#7c3aed]/5 dark:border-white/10'
      }`}
    >
      <p>
        Margem SimIntPay:{' '}
        <strong data-testid="margin-affiliate-total">
          {formatPercentage(bps)}%
        </strong>{' '}
        a afiliados
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Pago da margem (taxas menos custo do adquirente), fora da divisão do
        líquido com coprodutores e afiliados.
      </p>
    </div>
  );
}
