'use client';

import { useState } from 'react';
import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DebouncedInput as Input } from '../../../components';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { endpoints } from '@/services/api/endpoints';
import {
  useClienteApi,
  formatCurrencyFromNumber,
  formatCurrencyInput,
  parseCurrencyInput,
  VALOR_MINIMO,
  VALOR_MINIMO_ERRO,
} from '../../../_shared';
import { useProductEdit } from '../../../use-product-edit';
import {
  ProductFormLayout,
  ProductFormActions,
  ProductFormSection,
  ProductEditState,
  ProductPlatformSection,
} from '../../../components';

const INTERVAL_TYPE_TO_TIPO: Record<string, string> = {
  mes: 'MENSAL',
  ano: 'ANUAL',
  semana: 'SEMANAL',
  trimestre: 'TRIMESTRAL',
  semestre: 'SEMESTRAL',
};

export default function CriarPlanoClientePage() {
  const router = useRouter();
  const coproduction = useCoproductionDraft();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const api = useClienteApi();
  const platformCatalog = useProductPlatforms();
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const fieldTheme: 'light' | 'dark' =
    resolvedTheme === 'dark' ? 'dark' : 'light';

  const [nome, setNome] = useState('');
  const [amount, setAmount] = useState('0,00');
  const [intervalType, setIntervalType] = useState('mes');
  const [intervalCount, setIntervalCount] = useState(1);
  const [valorError, setValorError] = useState<string | null>(null);

  const edit = useProductEdit('planos', endpoints.planos.detail, (d) => {
    setNome(d.nome ?? '');
    setAmount(formatCurrencyFromNumber(Number(d.preco ?? 0)));
    const intervals: Record<string, string> = {
      MENSAL: 'mes',
      ANUAL: 'ano',
      SEMANAL: 'semana',
      TRIMESTRAL: 'trimestre',
      SEMESTRAL: 'semestre',
    };
    setIntervalType(intervals[d.tipo ?? 'MENSAL'] ?? 'mes');
    setIntervalCount(Number(d.frequencia ?? 1));
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      edit.id
        ? api.post(endpoints.planos.update(edit.id), body)
        : api.post(endpoints.planos.create, coproduction.withBody(body)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: edit.id ? 'Plano atualizado' : 'Plano criado',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: ['cliente-plans'] });
      router.push('/cliente/planos');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar o plano.',
      });
    },
  });

  function handleSave() {
    if (!edit.ready || createMutation.isPending) return;
    if (
      !edit.id &&
      (platformCatalog.isLoading ||
        platformCatalog.isError ||
        !platformCatalog.isDestinationValid(selectedPlatform))
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          'Selecione um titular ou uma plataforma válida para continuar.',
      });
      return;
    }
    if (!nome.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o nome do plano.',
      });
      return;
    }
    const preco = parseCurrencyInput(amount);
    if (preco < VALOR_MINIMO) {
      setValorError(VALOR_MINIMO_ERRO);
      toast({ type: 'error', title: 'Erro', description: VALOR_MINIMO_ERRO });
      return;
    }
    setValorError(null);
    createMutation.mutate({
      ...(edit.id ? {} : platformCatalog.destinationBody(selectedPlatform)),
      nome: nome.trim(),
      preco,
      ...(edit.id &&
      INTERVAL_TYPE_TO_TIPO[intervalType] === edit.query.data?.tipo
        ? {}
        : { tipo: INTERVAL_TYPE_TO_TIPO[intervalType] ?? 'MENSAL' }),
      ...(edit.id && intervalCount === Number(edit.query.data?.frequencia ?? 1)
        ? {}
        : { frequencia: intervalCount }),
      ...(edit.id ? {} : { repeticoes: 1, diasRetentativa: 10 }),
    });
  }

  if (!edit.ready)
    return (
      <ProductEditState
        loading={edit.loading}
        retry={() => void edit.query.refetch()}
      />
    );

  return (
    <ProductFormLayout
      path="/cliente/planos"
      listTitle="Planos"
      title={edit.id ? 'Editar plano' : 'Criar plano'}
    >
      {!edit.id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={selectedPlatform}
          onChange={setSelectedPlatform}
          theme={fieldTheme}
        />
      )}
      <ProductFormSection title="Configuração do plano">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Nome do plano"
              required
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Plano básico"
              value={nome}
              onChange={setNome}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Input
              label="Valor"
              required
              theme={fieldTheme}
              variant="navbar"
              prefix="R$"
              placeholder="0,00"
              inputMode="decimal"
              value={amount}
              error={valorError ?? undefined}
              onChange={(v) => {
                setAmount(formatCurrencyInput(v));
                if (valorError) setValorError(null);
              }}
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Valor mínimo: R$ {VALOR_MINIMO.toFixed(2).replace('.', ',')}
            </p>
          </div>
          <Dropdown
            label="Tipo de intervalo"
            theme={fieldTheme}
            variant="navbar"
            value={intervalType}
            onChange={setIntervalType}
            options={[
              { label: 'Semanal', value: 'semana' },
              ...(intervalType === 'trimestre'
                ? [{ label: 'Trimestral', value: 'trimestre' }]
                : []),
              ...(intervalType === 'semestre'
                ? [{ label: 'Semestral', value: 'semestre' }]
                : []),
              { label: 'Mensal', value: 'mes' },
              { label: 'Anual', value: 'ano' },
            ]}
          />
          <Dropdown
            label="A cada (intervalos)"
            theme={fieldTheme}
            variant="navbar"
            value={String(intervalCount)}
            onChange={(v) => setIntervalCount(Number(v) || 1)}
            options={Array.from(new Set([1, 2, 3, 4, 5, 6, intervalCount]))
              .sort((a, b) => a - b)
              .map((n) => ({ label: String(n), value: String(n) }))}
          />
        </div>
      </ProductFormSection>

      <CoproductionButton
        product="planos"
        productId={edit.id}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <ProductFormActions
        path="/cliente/planos"
        pending={createMutation.isPending}
        ready={
          edit.ready &&
          (Boolean(edit.id) ||
            (!platformCatalog.isLoading &&
              !platformCatalog.isError &&
              platformCatalog.isDestinationValid(selectedPlatform)))
        }
        onSave={handleSave}
      />
    </ProductFormLayout>
  );
}
