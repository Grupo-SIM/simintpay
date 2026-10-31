'use client';

import { useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { AdditiveFeeEditModal } from './AdditiveFeeEditModal';
import {
  formatFeeValue,
  SCOPE_LABELS,
  type AdditiveFeeEdit,
  type CompanyAdditiveFee,
} from './financial-types';

/** Fees associated to the platform; `fees` already reflects the draft edits. */
export function AdditiveFeesSection({
  fees,
  admin,
  onEdit,
}: {
  fees: CompanyAdditiveFee[];
  admin: boolean;
  onEdit: (edit: AdditiveFeeEdit) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const associated = fees.filter((fee) => fee.associated),
    available = fees.filter((fee) => !fee.associated);
  const editingFee = fees.find((fee) => fee.id === editing);
  return (
    <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
      <legend className="px-1 text-sm font-semibold">Taxas adicionais</legend>
      <ul className="divide-y divide-zinc-200 dark:divide-white/10">
        {associated.length === 0 && (
          <li className="py-2 text-sm text-zinc-500">
            Nenhuma taxa adicional associada.
          </li>
        )}
        {associated.map((fee) => (
          <li key={fee.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {fee.name}
                {!fee.active && (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                    Inativa no catálogo
                  </span>
                )}
                {(fee.percentageOverride !== null ||
                  fee.fixedOverride !== null) && (
                  <span className="ml-2 text-xs text-zinc-500">
                    Personalizada
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-500">
                {formatFeeValue(
                  fee.effectivePercentageValue,
                  fee.effectiveFixedValue,
                )}{' '}
                · {SCOPE_LABELS[fee.applicationScope]}
              </div>
            </div>
            {admin && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Editar ${fee.name}`}
                  title="Editar"
                  className="cursor-pointer"
                  onClick={() => setEditing(fee.id)}
                >
                  <Pencil size={16} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Desassociar ${fee.name}`}
                  title="Desassociar"
                  className="cursor-pointer"
                  onClick={() => onEdit({ feeId: fee.id, associated: false })}
                >
                  <X size={16} />
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {admin && available.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-72">
            <CustomSelect
              label="Associar taxa"
              value={selected}
              onChange={setSelected}
              options={available.map((fee) => ({
                value: fee.id,
                label: `${fee.name} (${formatFeeValue(fee.percentageValue, fee.fixedValue)})`,
              }))}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!selected}
            className="cursor-pointer disabled:cursor-not-allowed"
            onClick={() => {
              onEdit({ feeId: selected, associated: true });
              setSelected('');
            }}
          >
            <Plus size={16} /> Associar
          </Button>
        </div>
      )}
      {editingFee && (
        <AdditiveFeeEditModal
          fee={editingFee}
          onClose={() => setEditing(null)}
          onSave={(edit) => {
            onEdit(edit);
            setEditing(null);
          }}
        />
      )}
    </fieldset>
  );
}
