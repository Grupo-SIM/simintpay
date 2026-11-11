const percentage = (bps: number) =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

type Info =
  | {
      role: 'OWNER' | 'COPRODUCER';
      participantsCount?: number;
      myPercentageBps?: number | null;
    }
  | null
  | undefined;

export function CoproductionBadge({ info }: { info: Info }) {
  if (!info) return null;
  const label =
    info.role === 'COPRODUCER'
      ? `Coprodução${info.myPercentageBps ? ` · ${percentage(info.myPercentageBps)}` : ''}`
      : `Coprodução · ${info.participantsCount ?? 0} ${info.participantsCount === 1 ? 'parceiro' : 'parceiros'}`;
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
      {label}
    </span>
  );
}
