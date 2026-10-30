'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { ScrollArea } from '@/components/ui/ScrollArea';
import CriarContaTab from '../_components/CriarContaTab';

type Props = { onClose: () => void; onCreated: () => void };

export function CreateAccountDialog({ onClose, onCreated }: Props) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <DialogHeader>
          <DialogTitle>Criar conta</DialogTitle>
          <DialogDescription>
            Cadastre credenciais e documento do novo cliente.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <CriarContaTab onCreated={onCreated} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
