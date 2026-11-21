import { formatPercentage } from '@/features/coproduction/coproduction';
import type { JointResult } from '@/features/participations/joint';

/** Indicador fixo da divisão: total no pior caso (coprodutores + maior afiliado) e o que sobra ao dono. */
export function ParticipationTotals({
  result,
  showAffiliate = true,
}: {
  result: JointResult;
  showAffiliate?: boolean;
}) {
  const width = Math.min(100, result.totalBps / 100);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Divisão do líquido"
      data-over={result.exceeds}
      className={`space-y-2 border-b px-6 py-3 text-sm ${
        result.exceeds
          ? 'border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
          : 'border-zinc-200 bg-[#7c3aed]/5 dark:border-white/10'
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          Total repassado:{' '}
          <strong data-testid="participation-total">
            {formatPercentage(result.totalBps)}%
          </strong>
        </p>
        <p>
          Dono recebe:{' '}
          <strong data-testid="participation-owner">
            {formatPercentage(result.ownerBps)}%
          </strong>
        </p>
      </div>
      <div
        aria-hidden
        className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10"
      >
        <div
          className={`h-full ${result.exceeds ? 'bg-red-500' : 'bg-[#7c3aed]'}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Coprodutores {formatPercentage(result.coproducersBps)}%
        {showAffiliate &&
          ` · Afiliado${result.affiliate ? ` ${result.affiliate.label} ${formatPercentage(result.affiliate.bps)}%` : ' 0%'}`}
        {showAffiliate && ' (pior caso)'}
      </p>
      {result.overlaps.length > 0 && (
        <p role="note" className="text-xs text-amber-700 dark:text-amber-400">
          {result.overlaps.join(', ')}: está em coprodução e afiliação e conta
          uma vez só por venda (vale a entrada mais específica; no empate, a de
          coprodutor).
        </p>
      )}
      {result.exceeds && (
        <p className="text-xs font-medium text-red-700 dark:text-red-400">
          Acima de 100% em {formatPercentage(result.overBps)}%. Ajuste os
          percentuais para salvar.
        </p>
      )}
    </div>
  );
}
