'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ActionButton } from '@/app/(dashboard)/relatorio/components/ActionButton';
import { ChargeHistory } from '../contas/_components/charges/ChargeHistory';
import { NewChargeForm } from '../contas/_components/charges/NewChargeForm';

export default function AdminCobrancasPage() {
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-5 p-6 text-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Cobranças</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Histórico de todas as cobranças lançadas e criação para todos os
            clientes ou um específico.
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
      <ChargeHistory />
      {creating && (
        <NewChargeForm
          onClose={() => setCreating(false)}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
