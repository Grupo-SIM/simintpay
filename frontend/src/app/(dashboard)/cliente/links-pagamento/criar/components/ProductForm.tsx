'use client';

import { useState } from 'react';
import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { CoproductionButton } from '@/components/coproduction';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormSwitch } from './FormSwitch';
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

export default function CriarLinkPagamentoClientePage() {
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
  const [parcelasMax, setParcelasMax] = useState('12');
  const [cartaoCredito, setCartaoCredito] = useState(true);
  const [debito, setDebito] = useState(true);
  const [pix, setPix] = useState(true);
  const [valorError, setValorError] = useState<string | null>(null);

  const edit = useProductEdit(
    'links-pagamento',
    endpoints.linksPagamento.detail,
    (d) => {
      setTitulo(d.titulo ?? '');
      setDescricao(d.descricao ?? '');
      setAmount(formatCurrencyFromNumber(Number(d.valor ?? 0)));
      setParcelasMax(String(d.parcelasMax ?? 12));
      setCartaoCredito(d.aceitaCartao ?? true);
      setDebito(d.aceitaDebito ?? true);
      setPix(d.aceitaPix ?? true);
    },
  );

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      edit.id
        ? api.put(endpoints.linksPagamento.update(edit.id), body)
        : api.post(
            endpoints.linksPagamento.create,
            coproduction.withBody(body),
          ),
    onSuccess: () => {
      toast({
        type: 'success',
        title: edit.id
          ? 'Link de pagamento atualizado'
          : 'Link de pagamento criado',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({
        queryKey: ['cliente-links-pagamento'],
      });
      router.push('/cliente/links-pagamento');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          error?.message || 'Não foi possível salvar o link de pagamento.',
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
    if (!titulo.trim()) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe o título do link.',
      });
      return;
    }
    const valor = parseCurrencyInput(amount);
    if (valor < VALOR_MINIMO) {
      setValorError(VALOR_MINIMO_ERRO);
      toast({ type: 'error', title: 'Erro', description: VALOR_MINIMO_ERRO });
      return;
    }
    if (!cartaoCredito && !debito && !pix) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione ao menos uma forma de pagamento.',
      });
      return;
    }
    setValorError(null);
    createMutation.mutate({
      ...(edit.id ? {} : platformCatalog.destinationBody(selectedPlatform)),
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      valor,
      parcelasMax: cartaoCredito ? Number(parcelasMax) || 1 : 1,
      aceitaCartao: cartaoCredito,
      aceitaDebito: debito,
      aceitaPix: pix,
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
      path="/cliente/links-pagamento"
      listTitle="Links de Pagamento"
      title={edit.id ? 'Editar link de pagamento' : 'Criar link de pagamento'}
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
              label="Título do link"
              required
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Mentoria individual"
              value={titulo}
              onChange={setTitulo}
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Descrição"
              theme={fieldTheme}
              variant="navbar"
              placeholder="Breve descrição do produto"
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
          <Dropdown
            label="Máximo de parcelas (cartão)"
            theme={fieldTheme}
            variant="navbar"
            value={parcelasMax}
            onChange={setParcelasMax}
            disabled={!cartaoCredito}
            options={Array.from({ length: 12 }, (_, i) => ({
              label: `${i + 1}x`,
              value: String(i + 1),
            }))}
          />
        </div>
      </ProductFormSection>

      <ProductFormSection title="Formas de pagamento">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cartão de crédito
            </span>
            <FormSwitch checked={cartaoCredito} onChange={setCartaoCredito} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Cartão de débito
            </span>
            <FormSwitch checked={debito} onChange={setDebito} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              PIX
            </span>
            <FormSwitch checked={pix} onChange={setPix} />
          </div>
        </div>
      </ProductFormSection>

      <CoproductionButton
        product="links-pagamento"
        productId={edit.id}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <ProductFormActions
        path="/cliente/links-pagamento"
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
