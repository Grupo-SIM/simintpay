'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { FinancialNumberField } from './FinancialNumberField';
import { PlatformField } from './PlatformField';
import {
  DISPLAY_MODE_LABELS,
  SCOPE_LABELS,
  type AdditiveFee,
  type AdditiveFeeDisplayMode,
  type AdditiveFeeScope,
} from './financial-types';

export type AdditiveFeeInput = Omit<AdditiveFee, 'id'>;

/** Catalog create/edit form (admin, GLOBAL tab). */
export function AdditiveFeeFormModal({
  fee,
  saving,
  onSave,
  onClose,
}: {
  fee?: AdditiveFee;
  saving: boolean;
  onSave: (input: AdditiveFeeInput) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AdditiveFeeInput>(
    fee ?? {
      name: '',
      applicationScope: 'order',
      displayMode: 'checkout_only',
      percentageValue: 0,
      fixedValue: 0,
      active: true,
    },
  );
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const validity = (name: string, valid: boolean) =>
    setInvalid((previous) => ({ ...previous, [name]: !valid }));
  return (
    <Modal
      open
      onClose={onClose}
      title={fee ? 'Editar taxa adicional' : 'Nova taxa adicional'}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={
              saving ||
              !draft.name.trim() ||
              Object.values(invalid).some(Boolean)
            }
            className="cursor-pointer rounded border border-violet-500 bg-violet-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer rounded border px-4 py-2"
            onClick={onClose}
          >
            Descartar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <PlatformField
          name="additive-fee-name"
          label="Nome"
          required
          value={draft.name}
          placeholder="Ex: Taxa de serviço"
          onChange={(name) => setDraft((previous) => ({ ...previous, name }))}
        />
        <CustomSelect
          label="Aplicação"
          value={draft.applicationScope}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              applicationScope: value as AdditiveFeeScope,
            }))
          }
          options={Object.entries(SCOPE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <CustomSelect
          label="Exibição"
          value={draft.displayMode}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              displayMode: value as AdditiveFeeDisplayMode,
            }))
          }
          options={Object.entries(DISPLAY_MODE_LABELS).map(
            ([value, label]) => ({ value, label }),
          )}
        />
        <FinancialNumberField
          name="additive-fee-percentage"
          label="Percentual"
          rate
          value={draft.percentageValue * 100}
          onChange={(ppm) =>
            setDraft((previous) => ({
              ...previous,
              percentageValue: Math.round(ppm / 100),
            }))
          }
          onValidityChange={validity}
        />
        <FinancialNumberField
          name="additive-fee-fixed"
          label="Fixo"
          value={draft.fixedValue}
          onChange={(fixedValue) =>
            setDraft((previous) => ({ ...previous, fixedValue }))
          }
          onValidityChange={validity}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={draft.active}
            onChange={(event) => {
              const active = event.currentTarget.checked;
              setDraft((previous) => ({ ...previous, active }));
            }}
          />
          Ativa
        </label>
      </div>
    </Modal>
  );
}
