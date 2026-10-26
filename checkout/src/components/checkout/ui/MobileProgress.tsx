import { cx } from '@/utils/cx';

/** Barra de progresso mobile (3 segmentos), cores exatas das telas 4a/4b/4c. */
export function MobileProgress({ step }: { step: 1 | 2 | 3 }) {
  const segs =
    step === 1
      ? [
          'bg-[linear-gradient(90deg,#8d80f4,#f58a2a)]',
          'bg-white/[0.14]',
          'bg-white/[0.14]',
        ]
      : step === 2
        ? [
            'bg-[linear-gradient(90deg,#8d80f4,#c9a0c8)]',
            'bg-[linear-gradient(90deg,#c9a0c8,#f58a2a)]',
            'bg-white/[0.14]',
          ]
        : ['bg-[#8d80f4]', 'bg-[#c9a0c8]', 'bg-[#f58a2a]'];
  return (
    <div className="flex gap-1.5 lg:hidden">
      {segs.map((c, i) => (
        <span key={i} className={cx('h-1 flex-1 rounded-[9px]', c)} />
      ))}
    </div>
  );
}
