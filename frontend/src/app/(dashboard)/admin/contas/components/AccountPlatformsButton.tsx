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

type Entry = {
  id: string;
  platform: string;
  email?: string | null;
  role?: 'owner' | 'user';
};

type Props = {
  name: string;
  entries: Entry[];
};

const GROUPS = [
  { role: 'owner', label: 'Dono', title: 'Plataformas de que é dono' },
  { role: 'user', label: 'Usuário', title: 'Plataformas em que é usuário' },
] as const;

export function AccountPlatformsButton({ name, entries }: Props) {
  const [openRole, setOpenRole] = useState<'owner' | 'user' | null>(null);
  const byRole = (role: 'owner' | 'user') =>
    entries.filter((e) => (e.role ?? 'user') === role);
  const active = GROUPS.find((g) => g.role === openRole);
  const activeEntries = openRole ? byRole(openRole) : [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map((group) => {
          const count = byRole(group.role).length;
          if (count === 0) return null;
          return (
            <button
              key={group.role}
              type="button"
              onClick={() => setOpenRole(group.role)}
              className="inline-flex cursor-pointer items-center whitespace-nowrap gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium hover:bg-zinc-50 dark:border-white/10 dark:hover:bg-white/5"
            >
              <Layers size={14} />
              {group.label} ({count})
            </button>
          );
        })}
      </div>
      <Dialog
        open={openRole !== null}
        onOpenChange={(open) => !open && setOpenRole(null)}
      >
        <DialogContent className="max-w-lg bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
          <DialogHeader>
            <DialogTitle>
              {active?.title} — {name}
            </DialogTitle>
            <DialogDescription>
              Plataformas vinculadas e respectivos e-mails.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] space-y-3">
            {activeEntries.map((entry) => (
              <div key={entry.id} className="space-y-2 rounded-xl border p-3">
                <PlatformBadges platforms={[entry.platform]} />
                <p className="break-words text-sm text-zinc-500 dark:text-zinc-400">
                  {entry.email || 'E-mail não informado'}
                </p>
              </div>
            ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
