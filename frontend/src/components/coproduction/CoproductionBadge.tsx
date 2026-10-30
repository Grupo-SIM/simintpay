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

const states: Record<string, string> = {
  AVAILABLE: 'creditado',
  LOCKED: 'em mediação',
  REVERSED: 'estornado',
};
const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type TransactionInfo =
  | {
      role: 'OWNER' | 'COPRODUCER';
      myAmountCents: number | null;
      state: string | null;
    }
  | null
  | undefined;

/** Participação do usuário numa venda com coprodução; coprodutor vê a transação somente leitura. */
export function CoproductionTransactionBadge({
  info,
}: {
  info: TransactionInfo;
}) {
  if (!info) return null;
  const share =
    info.myAmountCents == null
      ? ''
      : ` · ${info.role === 'COPRODUCER' ? 'Sua parte' : 'Parte do dono'} ${money(info.myAmountCents)}`;
  const state = info.state ? ` (${states[info.state] ?? info.state})` : '';
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{`Coprodução${share}${state}`}</span>
  );
}
