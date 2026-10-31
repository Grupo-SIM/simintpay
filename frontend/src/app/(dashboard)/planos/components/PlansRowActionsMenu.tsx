'use client';

import { CalendarCheck, CalendarX, FilePenLine, Trash2 } from 'lucide-react';
import {
  RowActionsMenu,
  type RowActionMenuItem,
} from '@/components/ui/RowActionsMenu';

type Action = 'editar' | 'desativar' | 'ativar' | 'excluir';

type Props = {
  rowId: string;
  isActive: boolean;
  fieldTheme: 'light' | 'dark';
  onAction?: (action: Action, rowId: string) => void;
};

export function PlansRowActionsMenu({
  rowId,
  isActive,
  fieldTheme,
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
    isActive
      ? {
          action: 'desativar',
          label: 'Desativar',
          icon: <CalendarX className="h-4 w-4 shrink-0" />,
          className: isDark ? 'text-zinc-200' : 'text-slate-700',
        }
      : {
          action: 'ativar',
          label: 'Ativar',
          icon: <CalendarCheck className="h-4 w-4 shrink-0" />,
          className: 'text-emerald-600 dark:text-emerald-400',
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
      ariaLabel="Ações do plano"
      items={items}
      onAction={onAction}
    />
  );
}
