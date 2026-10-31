'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { FinancialNumberField } from './FinancialNumberField';
import { PlatformField } from './PlatformField';
import type { Lane } from './financial-types';

export function FinancialContractModal({
  lane,
  credit,
  onSave,
  onClose,
}: {
  lane: Lane;
  credit: boolean;
  onSave: (lane: Lane, all?: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(lane));
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const validity = (name: string, valid: boolean) =>
    setInvalid((previous) => ({ ...previous, [name]: !valid }));
  const field = (
    part: 'contract' | 'sim',
    key: 'fixedCents' | 'ratePpm' | 'interestPpm',
    label: string,
  ) => (
    <FinancialNumberField
      key={`${part}-${key}`}
      name={`${part}-${key}`}
      label={label}
      value={draft[part][key]}
      rate={key !== 'fixedCents'}
      onValidityChange={validity}
      onChange={(value) =>
        setDraft((previous) => ({
          ...previous,
          [part]: { ...previous[part], [key]: value },
        }))
      }
    />
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Taxas administrativas"
      maxWidth="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer rounded border border-violet-500 bg-violet-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Object.values(invalid).some(Boolean)}
            onClick={() => onSave(draft)}
          >
            Salvar no rascunho
          </Button>
          {credit && (
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer rounded border px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={Object.values(invalid).some(Boolean)}
              onClick={() => onSave(draft, true)}
            >
              Aplicar taxas a todas
            </Button>
          )}
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
      <div className="space-y-5">
        <PlatformField
          name="contract-reference"
          label="Referência (opcional)"
          value={draft.contract.reference}
          placeholder="Ex: Tabela DOM outubro/2026"
          onChange={(reference) =>
            setDraft((previous) => ({
              ...previous,
              contract: { ...previous.contract, reference },
            }))
          }
        />
        <details open className="group rounded border p-3">
          <summary className="cursor-pointer font-semibold">
            Custo interno da adquirente{' '}
            <span className="text-xs font-normal group-open:hidden">
              · Expandir
            </span>
            <span className="hidden text-xs font-normal group-open:inline">
              · Minimizar
            </span>
            <span className="block text-xs font-normal">
              Fixo, percentual, cashback e base de cálculo
            </span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {field('contract', 'fixedCents', 'Fixo')}
            {field('contract', 'ratePpm', 'Percentual')}
            <FinancialNumberField
              name="cashback"
              label="Custo cashback"
              value={draft.contract.cashbackCents}
              onValidityChange={validity}
              onChange={(cashbackCents) =>
                setDraft((previous) => ({
                  ...previous,
                  contract: { ...previous.contract, cashbackCents },
                }))
              }
            />
            <CustomSelect
              label="Base de cálculo"
              value={draft.contract.base}
              options={[
                { value: 'ORIGINAL', label: 'Valor original' },
                { value: 'BUYER_TOTAL', label: 'Total do comprador' },
              ]}
              onChange={(base) =>
                setDraft((previous) => ({
                  ...previous,
                  contract: {
                    ...previous.contract,
                    base: base as Lane['contract']['base'],
                  },
                }))
              }
            />
          </div>
        </details>
        {draft.total && (
          <div className="grid gap-3 rounded border p-3 sm:grid-cols-2">
            <FinancialNumberField
              name="total-fixed"
              label="Custo total fixo (inclui adquirente)"
              value={draft.total.fixedCents}
              onValidityChange={validity}
              onChange={(fixedCents) =>
                setDraft((previous) => ({
                  ...previous,
                  total: { ...previous.total!, fixedCents },
                }))
              }
            />
            <FinancialNumberField
              name="total-rate"
              label="Custo total percentual (inclui adquirente)"
              rate
              value={draft.total.ratePpm}
              onValidityChange={validity}
              onChange={(ratePpm) =>
                setDraft((previous) => ({
                  ...previous,
                  total: { ...previous.total!, ratePpm },
                }))
              }
            />
          </div>
        )}
        {!draft.total && (
          <details open className="group rounded border p-3">
            <summary className="cursor-pointer font-semibold">
              Valores definidos SimIntPay{' '}
              <span className="text-xs font-normal group-open:hidden">
                · Expandir
              </span>
              <span className="hidden text-xs font-normal group-open:inline">
                · Minimizar
              </span>
              <span className="block text-xs font-normal">
                Fixo e percentual sobre valor original
              </span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {field('sim', 'fixedCents', 'Fixo')}
              {field('sim', 'ratePpm', 'Percentual do valor original')}
            </div>
          </details>
        )}
        {credit && (
          <details open className="group rounded border p-3">
            <summary className="cursor-pointer font-semibold">
              Juros por parcela{' '}
              <span className="text-xs font-normal group-open:hidden">
                · Expandir
              </span>
              <span className="hidden text-xs font-normal group-open:inline">
                · Minimizar
              </span>
              <span className="block text-xs font-normal">
                Adquirente e SimIntPay somados
              </span>
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {field('contract', 'interestPpm', 'Juros internos adquirente')}
              {field('sim', 'interestPpm', 'Juros definidos SimIntPay')}
            </div>
          </details>
        )}

        <p className="text-sm text-zinc-500">
          Salve a configuração para aplicar estas taxas às novas cobranças.
          Plataformas herdam as taxas globais sem ativação adicional.
        </p>
      </div>
    </Modal>
  );
}
