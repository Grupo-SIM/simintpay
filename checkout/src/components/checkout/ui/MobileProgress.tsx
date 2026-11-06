import { cx } from '@/utils/cx';

const COLORS = {
  2: ['bg-[#8d80f4]', 'bg-[#f58a2a]'],
  3: ['bg-[#8d80f4]', 'bg-[#c9a0c8]', 'bg-[#f58a2a]'],
} as const;

/** Barra de progresso mobile das etapas do formulário (o pedido é a etapa 0 e não entra). */
export function MobileProgress({
  step,
  total,
}: {
  step: number;
  total: 2 | 3;
}) {
  return (
    <div className="flex gap-1.5 lg:hidden">
      {COLORS[total].map((c, i) => (
        <span
          key={i}
          className={cx(
            'h-1 flex-1 rounded-[9px]',
            i < step ? c : 'bg-white/[0.14]',
          )}
        />
      ))}
    </div>
  );
}
