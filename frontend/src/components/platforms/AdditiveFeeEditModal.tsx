'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FinancialNumberField } from './FinancialNumberField';
import {
  formatFeeValue,
  type AdditiveFeeEdit,
  type CompanyAdditiveFee,
} from './financial-types';

/** Per-platform overrides of a catalog fee; blank values follow the catalog. */
export function AdditiveFeeEditModal({
  fee,
  onSave,
  onClose,
}: {
  fee: CompanyAdditiveFee;
  onSave: (edit: AdditiveFeeEdit) => void;
  onClose: () => void;
}) {
  const [percentage, setPercentage] = useState(fee.effectivePercentageValue);
  const [fixed, setFixed] = useState(fee.effectiveFixedValue);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const blocked = Object.values(invalid).some(Boolean);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Taxa adicional: ${fee.name}`}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={blocked}
            className="cursor-pointer rounded border border-violet-500 bg-violet-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() =>
              onSave({
                feeId: fee.id,
                percentageOverride:
                  percentage === fee.percentageValue ? null : percentage,
                fixedOverride: fixed === fee.fixedValue ? null : fixed,
              })
            }
          >
            Salvar no rascunho
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer rounded border px-4 py-2"
            onClick={() => {
              onSave({ feeId: fee.id, reset: true });
            }}
          >
            Restaurar padrão
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
        <p className="text-sm text-zinc-500">
          Padrão do catálogo:{' '}
          {formatFeeValue(fee.percentageValue, fee.fixedValue)}
          {!fee.active && ' (taxa inativa no catálogo, não é cobrada)'}
        </p>
        <FinancialNumberField
          name={`additive-${fee.id}-percentage`}
          label="Percentual nesta plataforma"
          rate
          value={percentage * 100}
          onChange={(ppm) => setPercentage(Math.round(ppm / 100))}
          onValidityChange={(name, valid) =>
            setInvalid((previous) => ({ ...previous, [name]: !valid }))
          }
        />
        <FinancialNumberField
          name={`additive-${fee.id}-fixed`}
          label="Fixo nesta plataforma"
          value={fixed}
          onChange={setFixed}
          onValidityChange={(name, valid) =>
            setInvalid((previous) => ({ ...previous, [name]: !valid }))
          }
        />
      </div>
    </Modal>
  );
}
