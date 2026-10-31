'use client';

import { useState } from 'react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ChargeHistory } from './ChargeHistory';
import { NewChargeForm } from './NewChargeForm';
import type { ChargeClient } from './types';

export function ClientChargesModal({
  client,
  onClose,
  onChanged,
}: {
  client: ChargeClient;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Modal
        open={!creating}
        title={`Cobranças — ${client.name}`}
        onClose={onClose}
        maxWidth="max-w-5xl"
      >
        <div className="space-y-5 text-zinc-900 dark:text-zinc-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Histórico de cobranças
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {client.email}
              </p>
            </div>
            <ActionButton
              type="button"
              variant="primary"
              onClick={() => setCreating(true)}
              className="cursor-pointer"
            >
              <Plus size={16} /> Nova cobrança
            </ActionButton>
          </div>
          <ChargeHistory client={client} />
        </div>
      </Modal>
      {creating && (
        <NewChargeForm
          client={client}
          onClose={() => setCreating(false)}
          onSuccess={onChanged}
        />
      )}
    </>
  );
}
