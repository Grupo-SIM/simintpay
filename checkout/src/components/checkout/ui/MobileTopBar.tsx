import { ArrowLeft } from 'lucide-react';

/** Header mobile das etapas internas: botão voltar + título. */
export function MobileTopBar({
  title,
  onBack,
}: {
  title: string;
  onBack?: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 lg:hidden">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Voltar"
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.08] transition hover:bg-white/[0.12]"
        >
          <ArrowLeft
            className="h-[18px] w-[18px] text-[#f4f2f7]"
            strokeWidth={2}
          />
        </button>
      ) : null}
      <span className="text-xl font-medium">{title}</span>
    </div>
  );
}
