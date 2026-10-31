'use client';

import { Layers } from 'lucide-react';

export function PlatformHeader({
  title,
  description,
  selectedName,
  open,
  onOpen,
  admin = false,
}: {
  title: string;
  description: string;
  selectedName: string;
  open: boolean;
  onOpen: () => void;
  admin?: boolean;
}) {
  return (
    <header className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{description}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-left dark:border-white/20 dark:bg-white/5"
      >
        <Layers size={20} />
        <span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            {admin
              ? 'Selecionar configuração financeira'
              : 'Selecionar ou gerenciar plataformas'}
          </span>
          <span className="font-semibold">{selectedName}</span>
        </span>
      </button>
    </header>
  );
}
