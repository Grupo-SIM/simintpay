'use client';

import { useState } from 'react';
import { Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { PlatformBadges } from '@/components/ui/PlatformBadges';

type Props = {
  name: string;
  entries: { id: string; platform: string; email?: string | null }[];
};

export function AccountPlatformsButton({ name, entries }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center whitespace-nowrap gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/5"
      >
        <Layers size={14} />
        Plataformas ({entries.length})
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          <DialogHeader>
            <DialogTitle>Plataformas de {name}</DialogTitle>
            <DialogDescription>
              Plataformas vinculadas e respectivos e-mails.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] space-y-3">
            {entries.length ? (
              entries.map((entry) => (
                <div key={entry.id} className="space-y-2 rounded-xl border p-3">
                  <PlatformBadges platforms={[entry.platform]} />
                  <p className="break-words text-sm text-zinc-500 dark:text-zinc-400">
                    {entry.email || 'E-mail não informado'}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-zinc-500">
                Nenhuma plataforma vinculada.
              </p>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
