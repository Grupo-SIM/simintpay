import { cx } from '@/utils/cx';
import { CheckDot } from '../../CheckDot';

const STEPS = ['Pedido', 'Dados', 'Pagamento'] as const;

/** Stepper do header desktop (1 Pedido — 2 Dados — 3 Pagamento). */
export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-3">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <div key={label} className="flex items-center gap-3">
            {i > 0 && (
              <span
                className={cx(
                  'h-0.5 w-12 rounded-sm',
                  n <= current
                    ? 'bg-[linear-gradient(90deg,#a99ef8,#f6b67a)]'
                    : 'bg-white/[0.14]',
                )}
              />
            )}
            <div className="flex items-center gap-2.5">
              {done ? (
                <CheckDot size={30} />
              ) : (
                <span
                  className={cx(
                    'flex h-[30px] w-[30px] items-center justify-center rounded-full text-[13px] font-semibold',
                    active
                      ? 'bg-[#f4f2f7] text-[#17131f]'
                      : 'bg-white/[0.12] text-[#a9a3b8]',
                  )}
                >
                  {n}
                </span>
              )}
              <span
                className={cx(
                  'text-[15px]',
                  done || active ? 'text-[#f4f2f7]' : 'text-[#a9a3b8]',
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
