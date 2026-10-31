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

type FrequencyOption =
  'WEEKLY' | 'MONTHLY' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

const FREQUENCY_TO_API: Record<FrequencyOption, string> = {
  WEEKLY: 'SEMANAL',
  MONTHLY: 'MENSAL',
  TRIMESTRAL: 'TRIMESTRAL',
  SEMESTRAL: 'SEMESTRAL',
  ANUAL: 'ANUAL',
};

export default function CriarLinkAssinaturaClientePage() {
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
  const [descricao, setDescricao] = useState('');
  const [amount, setAmount] = useState('0,00');
  const [frequencyType, setFrequencyType] =
    useState<FrequencyOption>('MONTHLY');
  const [paymentMethods, setPaymentMethods] = useState<
    'PIX' | 'CREDIT_CARD' | 'BOTH'
  >('BOTH');
  const [maxUses, setMaxUses] = useState('');
  const [redirectUrl, setRedirectUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [valorError, setValorError] = useState<string | null>(null);

  const edit = useProductEdit(
    'links-assinatura',
    endpoints.linksAssinatura.detail,
    (d) => {
      setNome(d.nome ?? '');
      setDescricao(d.descricao ?? '');
      setAmount(formatCurrencyFromNumber(Number(d.valor ?? 0)));
      const frequencies: Record<string, FrequencyOption> = {
        WEEKLY: 'WEEKLY',
        SEMANAL: 'WEEKLY',
        MONTHLY: 'MONTHLY',
        MENSAL: 'MONTHLY',
        TRIMESTRAL: 'TRIMESTRAL',
        SEMESTRAL: 'SEMESTRAL',
        ANUAL: 'ANUAL',
      };
      setFrequencyType(
        frequencies[d.frequencyType ?? String(d.frequencia ?? '')] ?? 'MONTHLY',
      );
      setPaymentMethods(d.paymentMethods ?? 'BOTH');
      setMaxUses(
        (d.maxUsos ?? d.maxUses) == null ? '' : String(d.maxUsos ?? d.maxUses),
      );
      setRedirectUrl(d.redirectUrl ?? '');
      setWebhookUrl(d.webhookUrl ?? '');
    },
  );

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      edit.id
        ? api.put(endpoints.linksAssinatura.update(edit.id), body)
        : api.post(
            endpoints.linksAssinatura.create,
            coproduction.withBody(body),
          ),
    onSuccess: () => {
      toast({
        type: 'success',
        title: edit.id
          ? 'Link de assinatura atualizado'
          : 'Link de assinatura criado',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({
        queryKey: ['cliente-links-assinatura'],
      });
      router.push('/cliente/links-assinatura');
    },
    onError: (error: Error) => {
      toast({
        type: 'error',
        title: 'Erro',
        description:
          error?.message || 'Não foi possível salvar o link de assinatura.',
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
        description: 'Informe o nome do link.',
      });
      return;
    }
    const valor = parseCurrencyInput(amount);
    if (valor < VALOR_MINIMO) {
      setValorError(VALOR_MINIMO_ERRO);
      toast({ type: 'error', title: 'Erro', description: VALOR_MINIMO_ERRO });
      return;
    }
    if (
      (!edit.id ||
        maxUses !==
          String(edit.query.data?.maxUsos ?? edit.query.data?.maxUses ?? '')) &&
      maxUses &&
      (!/^\d+$/.test(maxUses) ||
        !Number.isSafeInteger(Number(maxUses)) ||
        Number(maxUses) < 1)
    ) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Informe um limite de usos inteiro maior que zero.',
      });
      return;
    }
    for (const [url, original] of [
      [redirectUrl, edit.query.data?.redirectUrl],
      [webhookUrl, edit.query.data?.webhookUrl],
    ]) {
      if (!url?.trim() || (edit.id && url === original)) continue;
      try {
        if (!['http:', 'https:'].includes(new URL(url.trim()).protocol))
          throw new Error();
      } catch {
        toast({
          type: 'error',
          title: 'Erro',
          description:
            'Informe links válidos começando com https:// ou http://.',
        });
        return;
      }
    }
    setValorError(null);
    createMutation.mutate({
      ...(edit.id
        ? {}
        : { platformTag: selectedPlatform, plataformas: [selectedPlatform] }),
      nome: nome.trim(),
      descricao: descricao.trim(),
      valor,
      ...(edit.id &&
      FREQUENCY_TO_API[frequencyType] === edit.query.data?.frequencia
        ? {}
        : { frequencia: FREQUENCY_TO_API[frequencyType] }),
      paymentMethods,
      ...(!edit.id ||
      maxUses !==
        String(edit.query.data?.maxUsos ?? edit.query.data?.maxUses ?? '')
        ? { maxUses: maxUses.trim() ? Number(maxUses) : undefined }
        : {}),
      ...(!edit.id || redirectUrl !== (edit.query.data?.redirectUrl ?? '')
        ? { redirectUrl: redirectUrl.trim() || undefined }
        : {}),
      ...(!edit.id || webhookUrl !== (edit.query.data?.webhookUrl ?? '')
        ? { webhookUrl: webhookUrl.trim() || undefined }
        : {}),
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
      path="/cliente/links-assinatura"
      listTitle="Links de Assinatura"
      title={edit.id ? 'Editar link de assinatura' : 'Novo link de assinatura'}
    >
      {!edit.id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={selectedPlatform}
          onChange={setSelectedPlatform}
          theme={fieldTheme}
        />
      )}
      <ProductFormSection title="Configuração do link de assinatura">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Nome do link"
              required
              theme={fieldTheme}
              variant="navbar"
              placeholder="Ex: Assinatura Mensal Premium"
              value={nome}
              onChange={setNome}
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Descrição (opcional)"
              theme={fieldTheme}
              variant="navbar"
              placeholder="Breve descrição do plano"
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
            label="Frequência de cobrança"
            required
            theme={fieldTheme}
            variant="navbar"
            value={frequencyType}
            onChange={(v) => setFrequencyType(v as FrequencyOption)}
            options={[
              { label: 'Semanal', value: 'WEEKLY' },
              { value: 'MONTHLY', label: 'Mensal' },
              { value: 'TRIMESTRAL', label: 'Trimestral' },
              { value: 'SEMESTRAL', label: 'Semestral' },
              { value: 'ANUAL', label: 'Anual' },
            ]}
          />
          <Dropdown
            label="Formas de pagamento aceitas"
            required
            theme={fieldTheme}
            variant="navbar"
            value={paymentMethods}
            onChange={(v) =>
              setPaymentMethods(v as 'PIX' | 'CREDIT_CARD' | 'BOTH')
            }
            options={[
              { value: 'BOTH', label: 'PIX e Cartão de crédito' },
              { value: 'CREDIT_CARD', label: 'Somente Cartão de crédito' },
              { value: 'PIX', label: 'Somente PIX' },
            ]}
          />
        </div>
      </ProductFormSection>

      <ProductFormSection title="Configurações adicionais">
        {edit.id && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Campos vazios preservam as configurações existentes.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Limite de usos (opcional)"
            theme={fieldTheme}
            variant="navbar"
            placeholder="Ex: 100"
            inputMode="numeric"
            value={maxUses}
            onChange={setMaxUses}
          />
          <Input
            label="URL de redirecionamento (opcional)"
            theme={fieldTheme}
            variant="navbar"
            placeholder="https://exemplo.com/obrigado"
            value={redirectUrl}
            onChange={setRedirectUrl}
          />
          <div className="md:col-span-2">
            <Input
              label="URL do webhook (opcional)"
              theme={fieldTheme}
              variant="navbar"
              placeholder="https://exemplo.com/webhook"
              value={webhookUrl}
              onChange={setWebhookUrl}
            />
          </div>
        </div>
      </ProductFormSection>

      <CoproductionButton
        product="links-assinatura"
        productId={edit.id}
        draft={coproduction.participants}
        onDraftChange={coproduction.setParticipants}
        disabled={createMutation.isPending}
      />

      <ProductFormActions
        path="/cliente/links-assinatura"
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
