'use client';

import {
  CalendarX,
  PauseCircle,
  PlayCircle,
  Trash2,
  Check,
} from 'lucide-react';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import {
  RowActionsMenu,
  type RowActionMenuItem,
} from '@/components/ui/RowActionsMenu';

export type Action = 'desativar' | 'pausar' | 'retomar' | 'excluir';

type Props = {
  rowId: string;
  isPaused: boolean;
  isActive: boolean;
  canRemoveFromHistory: boolean;
  fieldTheme: 'light' | 'dark';
  onAction?: (action: Action, rowId: string) => void;
};

export function SubscribersRowActionsMenu({
  rowId,
  isPaused,
  isActive,
  canRemoveFromHistory,
  fieldTheme,
  onAction,
}: Props) {
  const isDark = fieldTheme === 'dark';

  const items: RowActionMenuItem<Action>[] = isPaused
    ? [
        {
          action: 'retomar',
          label: 'Retomar assinatura',
          icon: <PlayCircle className="h-4 w-4 shrink-0" />,
          className: isDark ? 'text-zinc-200' : 'text-slate-700',
        },
      ]
    : [
        ...(isActive
          ? [
              {
                action: 'pausar' as Action,
                label: 'Pausar assinatura',
                icon: <PauseCircle className="h-4 w-4 shrink-0" />,
                className: isDark ? 'text-zinc-200' : 'text-slate-700',
              },
            ]
          : []),
        ...(isActive
          ? [
              {
                action: 'desativar' as Action,
                label: 'Desativar',
                icon: <CalendarX className="h-4 w-4 shrink-0" />,
                className: 'text-red-600 dark:text-red-400',
              },
            ]
          : []),
      ];

  if (!isActive && !isPaused) {
    return canRemoveFromHistory ? (
      <ConfirmActionButton
        type="button"
        variant="outline"
        size="icon"
        className="cursor-pointer text-red-600"
        label="Excluir do histórico"
        confirmation="Ocultar assinatura desativada do histórico? Nada será apagado na DOM."
        confirmContent={<Check className="h-4 w-4" />}
        onConfirm={() => onAction?.('excluir', rowId)}
      >
        <Trash2 className="h-4 w-4" />
      </ConfirmActionButton>
    ) : null;
  }

  return (
    <RowActionsMenu
      rowId={rowId}
      fieldTheme={fieldTheme}
      ariaLabel="Ações do assinante"
      items={items}
      onAction={onAction}
    />
  );
}
