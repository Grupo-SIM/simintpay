'use client';

import { Check, Pencil, Power, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Button } from '@/components/ui/Button';
import type { ProductKind } from '../product-list';

type Props = {
  kind: ProductKind;
  id: string;
  deleting: boolean;
  onDelete: () => void;
  active: boolean;
  changingStatus: boolean;
  onToggle: () => void;
  readOnly?: boolean;
};

export function ProductRowActions({
  kind,
  id,
  deleting,
  onDelete,
  active,
  changingStatus,
  onToggle,
  readOnly = false,
}: Props) {
  const router = useRouter();
  if (readOnly)
    return (
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
        Somente leitura
      </p>
    );
  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        onClick={() =>
          router.push(`/cliente/${kind}/criar?id=${encodeURIComponent(id)}`)
        }
      >
        <Pencil aria-hidden className="h-4 w-4" /> Editar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer disabled:cursor-not-allowed"
        disabled={changingStatus}
        onClick={onToggle}
      >
        <Power aria-hidden className="h-4 w-4" />{' '}
        {active ? 'Inativar' : 'Ativar'}
      </Button>
      <ConfirmActionButton
        variant="outline"
        size="icon-sm"
        disabled={deleting}
        className="cursor-pointer text-red-600 disabled:cursor-not-allowed dark:text-red-400"
        label="Excluir"
        confirmation="Excluir permanentemente? Confirme em até 3 segundos."
        confirmContent={<Check aria-hidden className="h-4 w-4" />}
        onConfirm={onDelete}
      >
        <Trash2 aria-hidden className="h-4 w-4" />
      </ConfirmActionButton>
    </div>
  );
}
