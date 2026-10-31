'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import { useToast } from '@/components/ui/Toast';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { FeeModeField } from './FeeModeField';
import { FinancialBulkInterestField } from './FinancialBulkInterestField';
import { FinancialNumberField } from './FinancialNumberField';
import { FinancialContractModal } from './FinancialContractModal';
import { AcquirerManualFeeForm } from './AcquirerManualFeeForm';
import { FinancialSimulationCard } from './FinancialSimulationCard';
import { useFinancialSimulation } from './use-financial-simulation';
import {
  defaultLane,
  defaultOwner,
  type FeeMode,
  type FinancialConfiguration,
  type Lane,
  type OwnerRule,
} from './financial-types';

export function FinancialPolicyDraft({
  tag,
  configuration,
  admin,
  onDiscard,
}: {
  tag: string;
  configuration: FinancialConfiguration;
  admin: boolean;
  onDiscard: () => void;
}) {
  const api = useClienteApi(),
    queryClient = useQueryClient(),
    { toast } = useToast();
  const [feeMode, setFeeMode] = useState<FeeMode | null>(
    configuration.feeMode ?? null,
  );
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
  const [method, setMethod] = useState('CREDIT_CARD'),
    [channel, setChannel] = useState('ONLINE');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const acquirer = admin
    ? adminAcquirer
    : (configuration.keys
        .find((key) => {
          const [, keyMethod, keyChannel] = key.split('/');
          return keyMethod === method && keyChannel === channel;
        })
        ?.split('/')[0] ??
      configuration.keys[0]?.split('/')[0] ??
      'DOM');
  const credit = method === 'CREDIT_CARD';
  const keys = Array.from(
    { length: credit ? 12 : 1 },
    (_, i) => `${acquirer}/${method}/${channel}/${i + 1}`,
  );
  const percentages = keys.map(
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
    (!admin || !!acquirers.data?.data.some((item) => item.code === acquirer)) &&
    amountCents > 0 &&
    !Object.values(invalid).some(Boolean) &&
    /^[A-Z][A-Z0-9_-]{0,39}$/.test(acquirer);
  const changed = admin
    ? JSON.stringify(lanes) !==
        JSON.stringify(configuration.laneOverrides ?? {}) ||
      feeMode !== (configuration.feeMode ?? null)
    : JSON.stringify(owner) !== JSON.stringify(configuration.ownerOverrides) ||
      JSON.stringify(lanes) !==
        JSON.stringify(configuration.laneOverrides ?? {}) ||
      interestFreeOverride !== (configuration.interestFreeOverride ?? null);
  const simulation = useFinancialSimulation({
    tag,
    configuration,
    keys,
    amountCents,
    owner,
    lanes,
    interestFree: false,
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
              }
            : { owner, interestFree: interestFreeOverride }),
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
        keys.map((key) => [
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
      keys.flatMap((key) =>
        simulation.rows[key]?.error && !simulation.rows[key]?.pending
          ? [simulation.rows[key].error!]
          : [],
      ),
    ),
  ];
  const missingFeeKeys = keys.filter((key) =>
    simulation.rows[key]?.error?.includes('sem tabela ativa'),
  );
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
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <fieldset className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <legend className="px-2 text-sm font-semibold">
            Forma de pagamento
          </legend>
          <div
            className={`grid items-end gap-3 ${admin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
          >
            {admin && (
              <CustomSelect
                label="Adquirente"
                value={acquirer}
                onChange={setAcquirer}
                options={acquirers.data!.data.map((item) => ({
                  value: item.code,
                  label: `${item.name} (${item.code})`,
                }))}
              />
            )}
            <CustomSelect
              label="Modalidade"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'PIX', label: 'PIX' },
                { value: 'DEBIT_CARD', label: 'Débito' },
                { value: 'BOLETO', label: 'Boleto' },
                { value: 'CREDIT_CARD', label: 'Crédito' },
              ]}
            />
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
        </fieldset>
        <fieldset className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <legend className="px-2 text-sm font-semibold">
            Base da simulação
          </legend>
          <FinancialNumberField
            label="Valor original"
            name="simulation-amount"
            value={amountCents}
            onChange={setAmountCents}
            onValidityChange={validity}
          />
          <p className="mt-2 text-xs text-zinc-500">
            Valor antes das taxas e dos juros.
          </p>
        </fieldset>
      </div>
      {!admin && (
        <fieldset className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-white/10">
          <legend className="px-2 text-sm font-semibold">
            {credit ? 'Juros e parcelamento' : 'Custos da modalidade'}
          </legend>
          <div className="flex flex-wrap items-end gap-3">
            {credit && (
              <div className="w-full sm:w-72">
                <FinancialBulkInterestField
                  key={`${acquirer}/${method}/${channel}`}
                  value={commonPercentage}
                  onChange={changeAllInterest}
                  onValidityChange={validity}
                />
              </div>
            )}
            {credit && (
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
            )}
          </div>
          <p className="mt-3 text-sm text-zinc-500">
            Custos SimIntPay são descontados do seu recebimento e não são
            cobrados do cliente.
            {credit
              ? ' Apenas juros podem ser repassados.'
              : ' Cliente paga somente o valor original.'}
          </p>
        </fieldset>
      )}
      {admin && feeMode !== null && (
        <FeeModeField value={feeMode} onChange={setFeeMode} />
      )}
      {admin && (
        <p className="text-sm text-zinc-500">
          Configure taxas e juros SimIntPay comparando custos internos da
          adquirente. Cada parcela mantém juros próprios; repasse ao comprador é
          definido pelo dono da plataforma.
        </p>
      )}
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
      {admin && missingFeeKeys.length > 0 && (
        <AcquirerManualFeeForm
          key={`${acquirer}/${method}/${channel}`}
          acquirer={acquirer}
          method={method}
          channel={channel}
          installments={missingFeeKeys.map((key) => Number(key.split('/')[3]))}
          onSaved={() =>
            missingFeeKeys.forEach((key) => simulation.retryRow(key))
          }
        />
      )}
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
      <div
        role="region"
        aria-label="Simulação da modalidade"
        className={
          credit
            ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
            : 'max-w-sm'
        }
      >
        {keys.map((key) => (
          <FinancialSimulationCard
            key={key}
            rowKey={key}
            rule={owner[key] ?? configuration.globalOwner[key]}
            lane={lanes[key] ?? configuration.globalLanes?.[key]}
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
        ))}
      </div>
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
      {editing && (
        <FinancialContractModal
          lane={
            lanes[editing] ??
            configuration.globalLanes?.[editing] ??
            defaultLane()
          }
          credit={credit}
          onClose={() => setEditing(null)}
          onSave={(lane, all) => {
            setLanes((previous) => ({
              ...previous,
              ...Object.fromEntries(
                keys.map((key) => {
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
