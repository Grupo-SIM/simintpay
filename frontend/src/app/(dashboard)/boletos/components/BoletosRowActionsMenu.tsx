'use client';

import { FilePenLine, Trash2, Power, PowerOff } from 'lucide-react';
import {
  RowActionsMenu,
  type RowActionMenuItem,
} from '@/components/ui/RowActionsMenu';

type Action = 'editar' | 'excluir' | 'toggle';

type Props = {
  rowId: string;
  fieldTheme: 'light' | 'dark';
  /** Status atual — define se o item mostra "Inativar" (ativo) ou "Ativar" (inativo). */
  ativo: boolean;
  onAction?: (action: Action, rowId: string) => void;
};

export function BoletosRowActionsMenu({
  rowId,
  fieldTheme,
  ativo,
  onAction,
}: Props) {
  const isDark = fieldTheme === 'dark';

  const items: RowActionMenuItem<Action>[] = [
    {
      action: 'editar',
      label: 'Editar',
      icon: <FilePenLine className="h-4 w-4 shrink-0" />,
      className: isDark ? 'text-zinc-200' : 'text-slate-700',
    },
    {
      action: 'toggle',
      label: ativo ? 'Inativar boleto' : 'Ativar boleto',
      icon: ativo ? (
        <PowerOff className="h-4 w-4 shrink-0" />
      ) : (
        <Power className="h-4 w-4 shrink-0" />
      ),
      className: ativo
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400',
    },
    {
      action: 'excluir',
      label: 'Excluir',
      icon: <Trash2 className="h-4 w-4 shrink-0" />,
      className: 'text-red-600 dark:text-red-400',
    },
  ];

  return (
    <RowActionsMenu
      rowId={rowId}
      fieldTheme={fieldTheme}
      ariaLabel="Ações do boleto"
      items={items}
      onAction={onAction}
    />
  );
}
