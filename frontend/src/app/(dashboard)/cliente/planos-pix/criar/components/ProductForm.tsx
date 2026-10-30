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
import {
  splitPixDescription,
  editedPixDescription,
} from '../../../product-edit-data';
import { useProductEdit } from '../../../use-product-edit';
import {
  ProductFormLayout,
  ProductFormActions,
  ProductFormSection,
  ProductEditState,
  ProductPlatformSection,
} from '../../../components';

export default function CriarPlanoPixClientePage() {
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
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('0,00');
  const [frequencyType, setFrequencyType] = useState('MONTH');
  const [valorError, setValorError] = useState<string | null>(null);

  const edit = useProductEdit('planos-pix', endpoints.planosPix.detail, (d) => {
    const cleanDescription = splitPixDescription(d.description).text;
    setNome(cleanDescription);
    setDescription(cleanDescription);
    setAmount(formatCurrencyFromNumber(Number(d.price ?? 0)));
    const frequencies: Record<string, string> = {
      MONTHLY: 'MONTH',
      TRIMESTRAL: 'QUARTER',
      SEMESTRAL: 'SEMESTER',
      ANUAL: 'YEAR',
    };
    setFrequencyType(
      frequencies[d.frequency_type ?? ''] ?? d.frequency_type ?? 'MONTH',
    );
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      edit.id
        ? api.patch(endpoints.planosPix.update(edit.id), body)
        : api.post(endpoints.planosPix.create, coproduction.withBody(body)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: edit.id ? 'Plano PIX atualizado' : 'Plano PIX criado',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: ['cliente-pix-plans'] });
      router.push('/cliente/planos-pix');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar o plano PIX.',
      });
    },
  });

  function handleSave() {
    if (!edit.ready || createMutation.isPending) return;
    if (
      !edit.id &&
      (platformCatalog.isLoading ||
        platformCatalog.isError ||
        !platformCatalog.selectableTags.includes(selectedPlatform ?? ''))
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione uma plataforma ativa para continuar.',
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
    const price = parseCurrencyInput(amount);
    if (price < VALOR_MINIMO) {
      setValorError(VALOR_MINIMO_ERRO);
      toast({ type: 'error', title: 'Erro', description: VALOR_MINIMO_ERRO });
      return;
    }
    setValorError(null);
    createMutation.mutate({
      ...(edit.id ? {} : { tenantTag: selectedPlatform }),
      price,
      description: editedPixDescription(
        description.trim() || nome.trim(),
        edit.query.data?.description,
      ),
      frequency_type: frequencyType,
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
      path="/cliente/planos-pix"
      listTitle="Planos PIX"
      title={edit.id ? 'Editar plano PIX' : 'Criar plano por PIX'}
    >
      {!edit.id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={selectedPlatform}
          onChange={setSelectedPlatform}
          theme={fieldTheme}
        />
      )}
      <ProductFormSection title="Configuração do plano PIX">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Nome do plano"
              required
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Plano PIX Mensal"
              value={nome}
              onChange={(value) => {
                if (edit.id && description === nome) setDescription(value);
                setNome(value);
              }}
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Descrição"
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Acesso premium por 30 dias"
              value={description}
              onChange={setDescription}
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
            label="Tipo de plano"
            theme={fieldTheme}
            variant="navbar"
            value={frequencyType}
            onChange={setFrequencyType}
            options={[
              { label: 'Mensal (30 dias)', value: 'MONTH' },
              { label: 'Trimestral (90 dias)', value: 'QUARTER' },
              { label: 'Semestral (180 dias)', value: 'SEMESTER' },
              { label: 'Anual (365 dias)', value: 'YEAR' },
            ]}
          />
        </div>
      </ProductFormSection>

      <CoproductionButton
        product="planos-pix"
        productId={edit.id}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <ProductFormActions
        path="/cliente/planos-pix"
        pending={createMutation.isPending}
        ready={
          edit.ready &&
          (Boolean(edit.id) ||
            (!platformCatalog.isLoading &&
              !platformCatalog.isError &&
              platformCatalog.selectableTags.includes(selectedPlatform ?? '')))
        }
        onSave={handleSave}
      />
    </ProductFormLayout>
  );
}
