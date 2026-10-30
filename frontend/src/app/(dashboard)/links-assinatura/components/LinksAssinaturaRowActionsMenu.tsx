'use client';

import { FilePenLine, Power, PowerOff, Trash2, Users } from 'lucide-react';
import {
  RowActionsMenu,
  type RowActionMenuItem,
} from '@/components/ui/RowActionsMenu';

type Action = 'editar' | 'assinantes' | 'alternar-status' | 'excluir';

type Props = {
  rowId: string;
  isActive: boolean;
  fieldTheme: 'light' | 'dark';
  onAction?: (action: Action, rowId: string) => void;
};

export function LinksAssinaturaRowActionsMenu({
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
    {
      action: 'assinantes',
      label: 'Ver assinantes',
      icon: <Users className="h-4 w-4 shrink-0" />,
      className: isDark ? 'text-zinc-200' : 'text-slate-700',
    },
    {
      action: 'alternar-status',
      label: isActive ? 'Inativar' : 'Ativar',
      icon: isActive ? (
        <PowerOff className="h-4 w-4 shrink-0" />
      ) : (
        <Power className="h-4 w-4 shrink-0" />
      ),
      className: isActive
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
      ariaLabel="Ações do link de assinatura"
      items={items}
      onAction={onAction}
    />
  );
}
