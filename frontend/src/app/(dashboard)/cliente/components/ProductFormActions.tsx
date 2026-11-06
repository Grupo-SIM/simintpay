'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

export function ProductFormActions({
  path,
  pending,
  ready,
  onSave,
}: {
  path: string;
  pending: boolean;
  ready: boolean;
  onSave: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 cursor-pointer rounded-lg disabled:cursor-not-allowed"
        disabled={pending}
        onClick={() => router.push(path)}
      >
        Descartar
      </Button>
      <Button
        type="button"
        className="h-11 min-w-[200px] cursor-pointer rounded-lg border border-emerald-700 bg-emerald-700 text-base font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onSave}
        disabled={pending || !ready}
      >
        {pending ? 'Salvando...' : 'Salvar'}
      </Button>
    </div>
  );
}
