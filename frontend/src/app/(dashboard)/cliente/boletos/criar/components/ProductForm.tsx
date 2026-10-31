'use client';

import { BoletoDueDaysField } from '@/components/boletos/BoletoDueDaysField';

import { useState } from 'react';
import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DebouncedInput as Input } from '../../../components';
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

export default function CriarBoletoClientePage() {
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

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [amount, setAmount] = useState('0,00');
  const [vencimentoDias, setVencimentoDias] = useState('3');
  const [valorError, setValorError] = useState<string | null>(null);

  const edit = useProductEdit('boletos', endpoints.boletos.detail, (d) => {
    setTitulo(d.titulo ?? '');
    setDescricao(d.descricao ?? '');
    setAmount(formatCurrencyFromNumber(Number(d.valor ?? 0)));
    setVencimentoDias(d.vencimentoDias ? String(d.vencimentoDias) : '');
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      edit.id
        ? api.put(endpoints.boletos.update(edit.id), body)
        : api.post(endpoints.boletos.create, coproduction.withBody(body)),
    onSuccess: () => {
      toast({
        type: 'success',
        title: edit.id ? 'Boleto atualizado' : 'Boleto criado',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: ['cliente-boletos'] });
      router.push('/cliente/boletos');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar o boleto.',
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
    if (!titulo.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o título do boleto.',
      });
      return;
    }
    const valor = parseCurrencyInput(amount);
    if (valor < VALOR_MINIMO) {
      setValorError(VALOR_MINIMO_ERRO);
      toast({ type: 'error', title: 'Erro', description: VALOR_MINIMO_ERRO });
      return;
    }
    setValorError(null);
    createMutation.mutate({
      ...(edit.id ? {} : { plataformas: [selectedPlatform] }),
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      valor,
      vencimentoDias:
        vencimentoDias === ''
          ? 0
          : Math.min(90, Math.max(1, Number(vencimentoDias))),
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
      path="/cliente/boletos"
      listTitle="Boletos"
      title={edit.id ? 'Editar boleto' : 'Criar boleto'}
    >
      {!edit.id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={selectedPlatform}
          onChange={setSelectedPlatform}
          theme={fieldTheme}
        />
      )}
      <ProductFormSection title="Configurações gerais">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Título do boleto"
              required
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Mensalidade"
              value={titulo}
              onChange={setTitulo}
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Descrição"
              theme={fieldTheme}
              variant="navbar"
              placeholder="Breve descrição"
              value={descricao}
              onChange={setDescricao}
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
          <BoletoDueDaysField
            value={vencimentoDias}
            onChange={setVencimentoDias}
            theme={fieldTheme}
          />
        </div>
      </ProductFormSection>

      <CoproductionButton
        product="boletos"
        productId={edit.id}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <ProductFormActions
        path="/cliente/boletos"
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
