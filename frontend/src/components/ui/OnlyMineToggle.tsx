'use client';

import { useCurrentUser } from '@/hooks/use-current-user';

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
};

/** Filtro exclusivo de admin: ligado = só itens do próprio usuário; desligado = todos. */
export function OnlyMineToggle({
  checked,
  onChange,
  label = 'Mostrar apenas os meus',
}: Props) {
  const { user } = useCurrentUser();
  if (!user?.isAdmin) return null;

  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </button>
      {label}
    </label>
  );
}
