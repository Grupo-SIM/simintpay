'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { FeeModeField } from './FeeModeField';
import { AdditiveFeesSection } from './AdditiveFeesSection';
import { FinancialBulkInterestField } from './FinancialBulkInterestField';
import { FinancialNumberField } from './FinancialNumberField';
import { FinancialContractModal } from './FinancialContractModal';
import { AcquirerManualFeeForm } from './AcquirerManualFeeForm';
import { WithdrawalFeeCard } from './WithdrawalFeeCard';
import { FinancialSimulationCard } from './FinancialSimulationCard';
import { useFinancialSimulation } from './use-financial-simulation';
import {
  defaultLane,
  defaultOwner,
  laneId,
  PAYMENT_METHODS,
  type AdditiveTotals,
  type FeeMode,
  type FinancialConfiguration,
  type Lane,
  type OwnerRule,
} from './financial-types';
import type { Platform } from './types';

export function FinancialPolicyDraft({
  tag,
  configuration,
  admin,
  withdrawalFees,
  onDiscard,
}: {
  tag: string;
  configuration: FinancialConfiguration;
  admin: boolean;
  withdrawalFees?: Platform['withdrawalFees'];
  onDiscard: () => void;
}) {
  const api = useClienteApi(),
    queryClient = useQueryClient(),
    { toast } = useToast();
  const [feeMode, setFeeMode] = useState<FeeMode | null>(
    configuration.feeMode ?? null,
  );
  const [disabledLanes, setDisabledLanes] = useState<string[]>(
    configuration.disabledLanes ?? [],
  );
  const additiveView = configuration.additiveFees;
  const [additiveFeesDraft, setAdditiveFeesDraft] = useState<AdditiveTotals>(
    additiveView?.effective ?? {
      order: { percentageValue: 0, fixedValue: 0 },
      product: { percentageValue: 0, fixedValue: 0 },
    },
  );
  const additiveFeesDraftChanged =
    !!additiveView &&
    JSON.stringify(additiveFeesDraft) !==
      JSON.stringify(additiveView.effective);
  const additiveTotals = additiveView ? additiveFeesDraft : undefined;
  const disabledLanesChanged =
    configuration.disabledLanes != null &&
    JSON.stringify(disabledLanes) !==
      JSON.stringify(configuration.disabledLanes);
  const [owner, setOwner] = useState(() => {
    if (
      admin ||
      !(
        configuration.interestFreeOverride ??
        configuration.globalInterestFree ??
        false
      )
    )
      return configuration.ownerOverrides;
    return {
      ...configuration.ownerOverrides,
      ...Object.fromEntries(
        configuration.keys
          .filter((key) => key.split('/')[1] === 'CREDIT_CARD')
          .map((key) => [
            key,
            {
              ...(configuration.ownerOverrides[key] ??
                configuration.globalOwner[key] ??
                defaultOwner()),
              passInterestPpm: 0,
            },
          ]),
      ),
    };
  });
  const [lanes, setLanes] = useState(configuration.laneOverrides ?? {});
  const [interestFreeOverride, setInterestFreeOverride] = useState<
    boolean | null
  >(
    (configuration.interestFreeOverride ??
      configuration.globalInterestFree ??
      false)
      ? false
      : (configuration.interestFreeOverride ?? null),
  );
  const acquirers = useQuery({
    queryKey: ['platform-acquirers'],
    enabled: admin,
    queryFn: () =>
      api.get<{ data: { code: string; name: string }[] }>(
        '/platforms/acquirers',
      ),
  });
  const [amountCents, setAmountCents] = useState(10000);
  const [adminAcquirer, setAcquirer] = useState(
    configuration.keys[0]?.split('/')[0] ?? 'DOM',
  );
  const [channel, setChannel] = useState('ONLINE');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const acquirerFor = (method: string) =>
    admin
      ? adminAcquirer
      : (configuration.keys
          .find((key) => {
            const [, keyMethod, keyChannel] = key.split('/');
            return keyMethod === method && keyChannel === channel;
          })
          ?.split('/')[0] ??
        configuration.keys[0]?.split('/')[0] ??
        'DOM');
  const methodKeys = (method: string, installments: number) =>
    Array.from(
      { length: installments },
      (_, i) => `${acquirerFor(method)}/${method}/${channel}/${i + 1}`,
    );
  const groups = PAYMENT_METHODS.map((item) => ({
    ...item,
    keys: methodKeys(item.method, item.installments),
  }));
  const keys = groups.flatMap((group) => group.keys);
  const creditKeys = groups.find(
    (group) => group.method === 'CREDIT_CARD',
  )!.keys;
  const laneEnabled = (key: string) => !disabledLanes.includes(laneId(key));
  const toggleLane = (key: string, enabled: boolean) =>
    setDisabledLanes((previous) => {
      const next = new Set(previous);
      if (enabled) next.delete(laneId(key));
      else next.add(laneId(key));
      return [...next].sort();
    });
  const percentages = creditKeys.map(
    (key) =>
      (owner[key] ?? configuration.globalOwner[key])?.passInterestPpm ??
      1_000_000,
  );
  const commonPercentage = percentages.every(
    (value) => value === percentages[0],
  )
    ? percentages[0]
    : undefined;
  const interestFree = commonPercentage === 0;
  const valid =
    (!admin ||
      !!acquirers.data?.data.some((item) => item.code === adminAcquirer)) &&
    amountCents > 0 &&
    !Object.values(invalid).some(Boolean) &&
    keys.every((key) => /^[A-Z][A-Z0-9_-]{0,39}$/.test(key.split('/')[0]));
  const changed = admin
    ? JSON.stringify(lanes) !==
        JSON.stringify(configuration.laneOverrides ?? {}) ||
      feeMode !== (configuration.feeMode ?? null) ||
      additiveFeesDraftChanged ||
      disabledLanesChanged
    : JSON.stringify(owner) !== JSON.stringify(configuration.ownerOverrides) ||
      JSON.stringify(lanes) !==
        JSON.stringify(configuration.laneOverrides ?? {}) ||
      interestFreeOverride !== (configuration.interestFreeOverride ?? null) ||
      disabledLanesChanged;
  const simulation = useFinancialSimulation({
    tag,
    configuration,
    keys,
    amountCents,
    owner,
    lanes,
    interestFree: false,
    feeMode,
    additiveTotals,
    valid,
    admin,
  });
  const validity = (name: string, valid: boolean) =>
    setInvalid((previous) => ({ ...previous, [name]: !valid }));
  const save = useMutation({
    mutationFn: () =>
      api.patch<{ data: FinancialConfiguration }>(
        `/platforms/${encodeURIComponent(tag)}/financial-policy`,
        {
          version: configuration.version,
          ...(admin
            ? {
                lanes,
                ...(feeMode !== null &&
                feeMode !== (configuration.feeMode ?? null)
                  ? { feeMode }
                  : {}),
                ...(additiveFeesDraftChanged
                  ? { additiveFees: additiveFeesDraft }
                  : {}),
              }
            : { owner, interestFree: interestFreeOverride }),
          ...(disabledLanesChanged ? { disabledLanes } : {}),
        },
      ),
    onSuccess: async (response) => {
      queryClient.setQueryData(['financial-policy', tag, admin], response);
      await queryClient.invalidateQueries({
        queryKey: ['financial-policy'],
        refetchType: 'active',
      });
      await queryClient.invalidateQueries({
        queryKey: ['platform-simulation'],
      });
      toast({
        type: 'success',
        title: 'Configuração salva',
        description: 'Somente novas cobranças usam esta versão.',
      });
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Não foi possível salvar',
        description: error.message,
      }),
  });
  const changeOwner = (key: string, rule: OwnerRule) =>
    setOwner((previous) => ({ ...previous, [key]: rule }));
  const changeAllInterest = (passInterestPpm: number) => {
    setInterestFreeOverride(false);
    setOwner((previous) => ({
      ...previous,
      ...Object.fromEntries(
        creditKeys.map((key) => [
          key,
          {
            ...(previous[key] ??
              configuration.globalOwner[key] ??
              defaultOwner()),
            passInterestPpm,
          },
        ]),
      ),
    }));
  };
  const errors = [
    ...new Set(
      keys
        .filter(laneEnabled)
        .flatMap((key) =>
          simulation.rows[key]?.error && !simulation.rows[key]?.pending
            ? [simulation.rows[key].error!]
            : [],
        ),
    ),
  ];
  const missingFeeKeys = keys
    .filter(laneEnabled)
    .filter((key) => simulation.rows[key]?.error?.includes('sem tabela ativa'));
  const missingFeeRoutes = [
    ...new Set(
      missingFeeKeys.map((key) => key.split('/').slice(0, 3).join('/')),
    ),
  ];
  if (admin && acquirers.isPending)
    return (
      <div
        role="status"
        aria-label="Carregando adquirentes"
        className="animate-pulse space-y-5"
      >
        <div className="h-32 rounded-xl bg-zinc-200 dark:bg-white/10" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              className="h-64 rounded-xl bg-zinc-200 dark:bg-white/10"
            />
          ))}
        </div>
      </div>
    );
  if (admin && acquirers.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>Falha ao carregar adquirentes.</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void acquirers.refetch()}
        >
          Tentar novamente
        </Button>
      </div>
    );
  if (admin && !acquirers.data?.data.length)
    return <p>Nenhuma adquirente cadastrada.</p>;
  const renderCard = (key: string, title: string, credit: boolean) => (
    <FinancialSimulationCard
      key={key}
      rowKey={key}
      title={title}
      enabled={laneEnabled(key)}
      onToggle={
        configuration.disabledLanes != null
          ? (enabled) => toggleLane(key, enabled)
          : undefined
      }
      rule={owner[key] ?? configuration.globalOwner[key]}
      lane={lanes[key] ?? configuration.globalLanes?.[key]}
      feeMode={feeMode}
      additiveTotals={additiveTotals}
      state={
        simulation.rows[key] ?? {
          installments: Number(key.split('/')[3]),
          pending: valid,
        }
      }
      admin={admin}
      credit={credit}
      onValidityChange={validity}
      onChange={(rule) => changeOwner(key, rule)}
      onEditContract={() => setEditing(key)}
    />
  );
  const editingGroup = editing
    ? groups.find((group) => group.keys.includes(editing))
    : undefined;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        {admin && (
          <div className="w-full sm:w-64">
            <CustomSelect
              label="Adquirente"
              value={adminAcquirer}
              onChange={setAcquirer}
              options={acquirers.data!.data.map((item) => ({
                value: item.code,
                label: `${item.name} (${item.code})`,
              }))}
            />
          </div>
        )}
        <div className="w-full sm:w-56">
          <CustomSelect
            label="Maquineta"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'ONLINE', label: 'Não (online)' },
              { value: 'POS', label: 'Sim' },
            ]}
          />
        </div>
        <div className="w-full sm:w-56">
          <FinancialNumberField
            label="Valor de simulação"
            name="simulation-amount"
            value={amountCents}
            onChange={setAmountCents}
            onValidityChange={validity}
          />
        </div>
      </div>
      {admin && feeMode !== null && (
        <FeeModeField value={feeMode} onChange={setFeeMode} />
      )}
      {admin && feeMode !== null && additiveView && (
        <AdditiveFeesSection
          value={additiveFeesDraft}
          onChange={setAdditiveFeesDraft}
          onValidityChange={validity}
        />
      )}
      <p className="text-sm text-zinc-500">
        {admin &&
          'Configure taxas e juros SimIntPay comparando custos internos da adquirente. Cada parcela mantém juros próprios; repasse ao comprador é definido pelo dono da plataforma. '}
        {configuration.disabledLanes != null &&
          'Modalidades desmarcadas são recusadas nesta plataforma.'}
      </p>
      {!valid && (
        <p role="alert" className="text-sm text-red-600">
          Confira valor original e campos financeiros. Resultados anteriores
          mantidos até corrigir campos.
        </p>
      )}
      {changed && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Simulação do rascunho ainda não salvo.
        </p>
      )}
      {admin &&
        missingFeeRoutes.map((route) => {
          const [routeAcquirer, routeMethod, routeChannel] = route.split('/');
          const routeKeys = missingFeeKeys.filter((key) =>
            key.startsWith(`${route}/`),
          );
          return (
            <AcquirerManualFeeForm
              key={route}
              acquirer={routeAcquirer}
              method={routeMethod}
              channel={routeChannel}
              installments={routeKeys.map((key) => Number(key.split('/')[3]))}
              onSaved={() =>
                routeKeys.forEach((key) => simulation.retryRow(key))
              }
            />
          );
        })}
      {errors.map((error) => (
        <div
          key={error}
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm text-red-600"
        >
          <p>
            {error === 'Contrato completo ainda não ativado'
              ? 'Simulação indisponível: taxas desta modalidade e canal não cadastradas.'
              : error}
          </p>
          <Button
            variant="outline"
            type="button"
            size="sm"
            className="cursor-pointer"
            onClick={() =>
              keys
                .filter((key) => simulation.rows[key]?.error === error)
                .forEach((key) => simulation.retryRow(key))
            }
          >
            Tentar novamente
          </Button>
        </div>
      ))}
      <section
        aria-label="Modalidades à vista"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {groups
          .filter((group) => group.method !== 'CREDIT_CARD')
          .map((group) => renderCard(group.keys[0], group.label, false))}
      </section>
      <section aria-label="Cartão de crédito" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">Cartão de crédito</h3>
          {!admin && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-72">
                <FinancialBulkInterestField
                  key={channel}
                  value={commonPercentage}
                  onChange={changeAllInterest}
                  onValidityChange={validity}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                aria-pressed={interestFree}
                className="h-auto min-h-10 cursor-pointer whitespace-normal text-left"
                onClick={() => changeAllInterest(interestFree ? 1_000_000 : 0)}
              >
                {interestFree
                  ? 'Repassar juros do parcelamento'
                  : 'Oferecer parcelamento sem juros'}
              </Button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {creditKeys.map((key) =>
            renderCard(key, `Crédito ${key.split('/')[3]}x`, true),
          )}
        </div>
      </section>
      {!admin && withdrawalFees && <WithdrawalFeeCard fees={withdrawalFees} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!changed || !valid || save.isPending}
          onClick={() => save.mutate()}
          className="cursor-pointer border disabled:cursor-not-allowed"
        >
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button
          variant="outline"
          type="button"
          disabled={save.isPending || !changed}
          onClick={() => {
            onDiscard();
            toast({ type: 'info', title: 'Alterações descartadas' });
          }}
          className="cursor-pointer disabled:cursor-not-allowed"
        >
          Descartar
        </Button>
      </div>
      {editing && editingGroup && (
        <FinancialContractModal
          lane={
            lanes[editing] ??
            configuration.globalLanes?.[editing] ??
            defaultLane()
          }
          credit={editingGroup.method === 'CREDIT_CARD'}
          onClose={() => setEditing(null)}
          onSave={(lane, all) => {
            setLanes((previous) => ({
              ...previous,
              ...Object.fromEntries(
                editingGroup.keys.map((key) => {
                  const existing =
                    previous[key] ??
                    configuration.globalLanes?.[key] ??
                    defaultLane();
                  return [
                    key,
                    {
                      ...lane,
                      contract: {
                        ...lane.contract,
                        interestPpm:
                          all || key === editing
                            ? lane.contract.interestPpm
                            : existing.contract.interestPpm,
                      },
                      sim: {
                        ...lane.sim,
                        interestPpm:
                          all || key === editing
                            ? lane.sim.interestPpm
                            : existing.sim.interestPpm,
                      },
                    },
                  ];
                }),
              ),
            }));
            setEditing(null);
            toast({ type: 'info', title: 'Taxas atualizadas no rascunho' });
          }}
        />
      )}
    </div>
  );
}
