'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { endpoints } from '@/services/api/endpoints';
import {
  DebouncedInput as Input,
  ProductEditState,
  ProductFormActions,
  ProductFormLayout,
  ProductFormSection,
  ProductPlatformSection,
} from '../../components';
import {
  formatCurrencyFromNumber,
  formatCurrencyInput,
  parseCurrencyInput,
  useClienteApi,
} from '../../_shared';
import { FormSwitch } from '../../links-pagamento/criar/components/FormSwitch';
import {
  OFFERS_QUERY_KEY,
  OFFER_KINDS,
  OFFER_METHODS,
  OFFER_PRESETS,
  digitsOnly,
  formFromOffer,
  formFromPreset,
  intervalLabels,
  kindDescriptions,
  kindLabels,
  methodLabels,
  offerPayload,
  renewalLabels,
  validateOfferForm,
  type Offer,
  type OfferForm,
  type OfferInterval,
  type OfferKind,
  type OfferMethod,
  type OfferRenewal,
} from '../offers';

const LIST_PATH = '/cliente/ofertas';

function PresetStep({ onPick }: { onPick: (kind: OfferKind) => void }) {
  return (
    <ProductFormSection title="1. Escolha um modelo">
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        O modelo preenche os padrões da oferta. Você ajusta tudo no próximo
        passo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {OFFER_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            data-testid={`preset-${kind}`}
            onClick={() => onPick(kind)}
            className="cursor-pointer rounded-xl border border-zinc-200 p-4 text-left transition-colors hover:border-emerald-600 hover:bg-emerald-50/50 dark:border-white/10 dark:hover:bg-white/5"
          >
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {kindLabels[kind]}
            </span>
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              {kindDescriptions[kind]}
            </span>
            <span className="mt-2 block text-xs text-zinc-400">
              {OFFER_PRESETS[kind].acceptedMethods
                .map((method) => methodLabels[method])
                .join(' · ')}
            </span>
          </button>
        ))}
      </div>
    </ProductFormSection>
  );
}

function OfferWizard() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const platformCatalog = useProductPlatforms();
  const theme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [form, setForm] = useState<OfferForm | null>(null);
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  // Não há GET por id: a edição lê a oferta da própria listagem do titular.
  const editQuery = useQuery({
    queryKey: [OFFERS_QUERY_KEY, user?.id],
    enabled: Boolean(id && user?.id),
    queryFn: () => api.get<Offer[]>(endpoints.ofertas.list),
  });
  const editing = id ? editQuery.data?.find((offer) => offer.id === id) : null;
  if (id && editing && hydratedId !== id) {
    setHydratedId(id);
    setForm(formFromOffer(editing, formatCurrencyFromNumber));
  }

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      id
        ? api.patch(endpoints.ofertas.update(id), body)
        : api.post(endpoints.ofertas.create, body),
    onSuccess: () => {
      toast({
        type: 'success',
        title: id ? 'Oferta atualizada' : 'Oferta criada',
        description: 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: [OFFERS_QUERY_KEY] });
      router.push(LIST_PATH);
    },
    onError: (error: Error) =>
      toast({
        type: 'error',
        title: 'Erro',
        description: error?.message || 'Não foi possível salvar a oferta.',
      }),
  });

  if (id && !editing)
    return (
      <ProductEditState
        loading={editQuery.isPending}
        retry={() => void editQuery.refetch()}
      />
    );

  const title = id ? 'Editar oferta' : 'Criar oferta';
  if (!form)
    return (
      <ProductFormLayout path={LIST_PATH} listTitle="Ofertas" title={title}>
        <PresetStep onPick={(kind) => setForm(formFromPreset(kind))} />
      </ProductFormLayout>
    );

  const patch = (changes: Partial<OfferForm>) =>
    setForm((current) => (current ? { ...current, ...changes } : current));
  const recurring = form.renewalMode !== 'NONE';
  const hasCredit = form.methods.includes('CREDIT_CARD');
  const platformReady =
    Boolean(id) ||
    (!platformCatalog.isLoading &&
      !platformCatalog.isError &&
      platformCatalog.selectableTags.includes(platform ?? ''));

  function toggleMethod(method: OfferMethod, on: boolean) {
    if (!form) return;
    const methods = on
      ? [...new Set([...form.methods, method])]
      : form.methods.filter((item) => item !== method);
    patch({
      methods,
      ...(method === 'CREDIT_CARD' && !on ? { maxInstallments: '1' } : {}),
    });
  }

  function handleSave() {
    if (!form || save.isPending) return;
    if (!id && !platformReady) {
      toast({
        type: 'error',
        title: 'Erro',
        description: 'Selecione uma plataforma ativa para continuar.',
      });
      return;
    }
    const amount = parseCurrencyInput(form.amount);
    const problem = validateOfferForm(form, amount);
    if (problem) {
      setAmountError(problem.includes('valor mínimo') ? problem : null);
      toast({ type: 'error', title: 'Erro', description: problem });
      return;
    }
    setAmountError(null);
    save.mutate(
      offerPayload(form, amount, id ? undefined : { platformTag: platform! }),
    );
  }

  return (
    <ProductFormLayout path={LIST_PATH} listTitle="Ofertas" title={title}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
        <span className="inline-flex items-center gap-2 font-medium text-emerald-900 dark:text-emerald-200">
          <Check aria-hidden className="h-4 w-4" />
          Modelo: {kindLabels[form.kind]}
        </span>
        {!id && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => setForm(null)}
          >
            Trocar modelo
          </Button>
        )}
      </div>

      {!id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={platform}
          onChange={setPlatform}
          theme={theme}
        />
      )}

      <ProductFormSection title="2. Dados da oferta">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label="Nome da oferta"
              required
              theme={theme}
              variant="navbar"
              placeholder="Ex: Mentoria individual"
              value={form.name}
              onChange={(name) => patch({ name })}
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Descrição"
              theme={theme}
              variant="navbar"
              placeholder="Breve descrição do produto"
              value={form.description}
              onChange={(description) => patch({ description })}
            />
          </div>
          <Input
            label="Valor"
            required
            theme={theme}
            variant="navbar"
            prefix="R$"
            placeholder="0,00"
            inputMode="decimal"
            value={form.amount}
            error={amountError ?? undefined}
            onChange={(value) => {
              patch({ amount: formatCurrencyInput(value) });
              if (amountError) setAmountError(null);
            }}
          />
          <Dropdown
            label="Máximo de parcelas (crédito)"
            theme={theme}
            variant="navbar"
            value={form.maxInstallments}
            onChange={(maxInstallments) => patch({ maxInstallments })}
            disabled={!hasCredit}
            options={Array.from({ length: 12 }, (_, i) => ({
              label: `${i + 1}x`,
              value: String(i + 1),
            }))}
          />
        </div>
      </ProductFormSection>

      <ProductFormSection title="3. Formas de pagamento">
        <div className="flex flex-col gap-4">
          {OFFER_METHODS.map((method) => (
            <div
              key={method}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {methodLabels[method]}
              </span>
              <FormSwitch
                checked={form.methods.includes(method)}
                onChange={(on) => toggleMethod(method, on)}
              />
            </div>
          ))}
        </div>
      </ProductFormSection>

      <ProductFormSection title="4. Recorrência">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Dropdown
              label="Modo de cobrança"
              theme={theme}
              variant="navbar"
              value={form.renewalMode}
              onChange={(value) =>
                patch({ renewalMode: value as OfferRenewal })
              }
              options={(Object.keys(renewalLabels) as OfferRenewal[]).map(
                (mode) => ({ value: mode, label: renewalLabels[mode] }),
              )}
            />
          </div>
          {recurring && (
            <>
              <Input
                label="A cada"
                theme={theme}
                variant="navbar"
                inputMode="numeric"
                value={form.intervalCount}
                onChange={(value) =>
                  patch({ intervalCount: digitsOnly(value) })
                }
              />
              <Dropdown
                label="Unidade"
                theme={theme}
                variant="navbar"
                value={form.intervalType}
                onChange={(value) =>
                  patch({ intervalType: value as OfferInterval })
                }
                options={(Object.keys(intervalLabels) as OfferInterval[]).map(
                  (interval) => ({
                    value: interval,
                    label: intervalLabels[interval],
                  }),
                )}
              />
              <Input
                label="Número de cobranças (vazio = até cancelar)"
                theme={theme}
                variant="navbar"
                inputMode="numeric"
                value={form.repetitions}
                onChange={(value) => patch({ repetitions: digitsOnly(value) })}
              />
            </>
          )}
        </div>
      </ProductFormSection>

      <ProductFormSection title="5. Limites e acesso">
        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Dias de acesso"
            theme={theme}
            variant="navbar"
            inputMode="numeric"
            placeholder="Sem prazo"
            value={form.accessDays}
            onChange={(value) => patch({ accessDays: digitsOnly(value) })}
          />
          <Input
            type="date"
            label="Expira em"
            theme={theme}
            variant="navbar"
            value={form.expiresAt}
            onChange={(expiresAt) => patch({ expiresAt })}
          />
          <Input
            label="Máximo de usos"
            theme={theme}
            variant="navbar"
            inputMode="numeric"
            placeholder="Ilimitado"
            value={form.maxUses}
            onChange={(value) => patch({ maxUses: digitsOnly(value) })}
          />
        </div>
      </ProductFormSection>

      <ProductFormActions
        path={LIST_PATH}
        pending={save.isPending}
        ready={platformReady}
        onSave={handleSave}
      />
    </ProductFormLayout>
  );
}

export default function CriarOfertaPage() {
  return (
    <Suspense fallback={<ProductEditState loading retry={() => {}} />}>
      <OfferWizard />
    </Suspense>
  );
}
