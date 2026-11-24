import { formatPercentage } from '@/features/coproduction/coproduction';
import type { MarginResult } from '@/features/participations/margin-joint';

/** Limite próprio da margem: independe do total conjunto do líquido. */
export function MarginAffiliateIndicator({ result }: { result: MarginResult }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Margem SimIntPay"
      data-over={result.exceeds}
      className={`space-y-1 border-b px-6 py-3 text-sm ${
        result.exceeds
          ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
          : 'border-zinc-200 bg-[#7c3aed]/5 dark:border-white/10'
      }`}
    >
      <p>
        Margem SimIntPay:{' '}
        <strong data-testid="margin-affiliate-total">
          {formatPercentage(result.totalBps)}%
        </strong>{' '}
        repassados
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Coprodutores {formatPercentage(result.coproducersBps)}% · Afiliado{' '}
        {formatPercentage(result.affiliateBps)}% (pior caso). Pago da margem
        (taxas menos custo do adquirente), fora da divisão do líquido.
      </p>
      {result.exceeds && (
        <p className="text-xs font-medium text-red-700 dark:text-red-400">
          Acima de 100% em {formatPercentage(result.overBps)}%. Ajuste os
          percentuais da margem para salvar.
        </p>
      )}
    </div>
  );
}
