'use client';

import { PaymentLinkPreviewModal } from '../../links-pagamento/criar/components/PaymentLinkPreviewModal';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dropdown } from '@/components/ui/Dropdown';
import { useToast } from '@/components/ui/Toast';
import { CoproductionButton } from '@/components/coproduction';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useProductPlatforms } from '@/hooks/use-product-platforms';
import { saveCoproduction } from '@/features/coproduction/coproduction.service';
import { useCoproductionDraft } from '@/features/coproduction/use-coproduction-draft';
import { endpoints } from '@/services/api/endpoints';
import { FormSwitch } from '../../cliente/links-pagamento/criar/components/FormSwitch';
import {
  DebouncedInput as Input,
  ProductEditState,
  ProductFormActions,
  ProductFormLayout,
  ProductFormSection,
  ProductPlatformSection,
} from '../../cliente/components';
import {
  formatCurrencyFromNumber,
  formatCurrencyInput,
  parseCurrencyInput,
  useClienteApi,
} from '../../cliente/_shared';
import {
  BOLETO_NOTE,
  MAX_BOLETO_DUE_DAYS,
  applyPreset,
  digitsOnly,
  formFromOffer,
  formFromPreset,
  hasBoleto,
  isRecurring,
  offerPayload,
  validateOfferForm,
  type OfferForm,
} from '../offer-form';
import {
  OFFERS_QUERY_KEY,
  OFFER_PRESET_KINDS,
  OFFER_METHODS,
  OFFER_PRESETS,
  enumLabel,
  intervalLabels,
  kindDescriptions,
  kindLabels,
  methodLabels,
  type Offer,
  type OfferInterval,
} from '../offers';
import { OfferBumpsSection } from './OfferBumpsSection';

const textareaClass =
  'min-h-28 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-emerald-600 dark:border-white/10';

function FormBody({
  offer,
  listHref,
  onSaved,
}: {
  offer: Offer | null;
  listHref: string;
  onSaved: (id: string, opts: { coproductionFailed: boolean }) => void;
}) {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const platformCatalog = useProductPlatforms();
  const coproduction = useCoproductionDraft();
  const theme: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
  const id = offer?.id ?? null;
  const [form, setForm] = useState<OfferForm>(() =>
    offer
      ? formFromOffer(offer, formatCurrencyFromNumber)
      : formFromPreset('PAYMENT_LINK'),
  );
  const [previewDraft, setPreviewDraft] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [platform, setPlatform] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const patch = (changes: Partial<OfferForm>) =>
    setForm((current) => ({ ...current, ...changes }));
  const fail = (description: string) =>
    toast({ type: 'error', title: 'Erro', description });

  const recurring = isRecurring(form);
  const hasCredit = form.methods.includes('CREDIT_CARD');
  const platformReady =
    Boolean(id) ||
    (!platformCatalog.isLoading &&
      !platformCatalog.isError &&
      platformCatalog.isDestinationValid(platform));

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (id) {
        await api.patch(endpoints.ofertas.update(id), body);
        return { id, coproductionFailed: false };
      }
      const created = await api.post<Offer>(endpoints.ofertas.create, body);
      // A oferta ainda não existia: a co-produção é gravada logo depois, com o id criado.
      let coproductionFailed = false;
      if (coproduction.participants.length > 0) {
        try {
          await saveCoproduction(
            api,
            'ofertas',
            created.id,
            0,
            coproduction.participants,
          );
        } catch {
          coproductionFailed = true;
        }
      }
      return { id: created.id, coproductionFailed };
    },
    onSuccess: (result) => {
      toast({
        type: result.coproductionFailed ? 'info' : 'success',
        title: id ? 'Oferta atualizada' : 'Oferta criada',
        description: result.coproductionFailed
          ? 'A oferta foi criada, mas a co-produção não foi salva. Configure-a novamente.'
          : 'Alterações salvas com sucesso.',
      });
      void queryClient.invalidateQueries({ queryKey: [OFFERS_QUERY_KEY] });
      onSaved(result.id, { coproductionFailed: result.coproductionFailed });
    },
    onError: (error: Error) =>
      fail(error?.message || 'Não foi possível salvar a oferta.'),
  });

  function toggleMethod(method: (typeof OFFER_METHODS)[number], on: boolean) {
    const methods = on
      ? [...new Set([...form.methods, method])]
      : form.methods.filter((item) => item !== method);
    patch({
      methods,
      ...(method === 'CREDIT_CARD' && !on ? { maxInstallments: '1' } : {}),
    });
  }

  function handleSave() {
    if (save.isPending) return;
    if (!id && !platformReady) {
      fail('Selecione um titular ou uma plataforma válida para continuar.');
      return;
    }
    const amount = parseCurrencyInput(form.amount);
    const problem = validateOfferForm(form, amount);
    if (problem) {
      setAmountError(problem.includes('valor mínimo') ? problem : null);
      fail(problem);
      return;
    }
    setAmountError(null);
    save.mutate({
      ...offerPayload(
        form,
        amount,
        id ? undefined : { platformTag: platform ?? undefined },
      ),
      ...(!id && !platform && platformCatalog.user?.isAdmin
        ? { ownerUserId: platformCatalog.financialOwner?.id }
        : {}),
    });
  }

  async function openPreview() {
    const amountCents = Math.round(
      (parseCurrencyInput(form.amount) || 0) * 100,
    );
    if (amountCents <= 0) {
      fail('Informe um valor para pré-visualizar o checkout.');
      return;
    }
    if (!platformReady) {
      fail('Selecione o destino financeiro da oferta.');
      return;
    }
    setPreviewPending(true);
    try {
      const pricing = await api.post<Record<string, unknown>>(
        '/ofertas/preview-pricing',
        {
          amountCents,
          maxInstallments: recurring ? 1 : Number(form.maxInstallments) || 1,
          acceptedMethods: form.methods,
          ...(id
            ? { offerId: id }
            : {
                platformTag: platform ?? undefined,
                ownerUserId: platformCatalog.financialOwner?.id,
              }),
        },
      );
      setPreviewDraft({
        code: 'preview',
        name: form.name || 'Nome da oferta',
        description: form.description,
        amountCents,
        acceptedMethods: form.methods,
        maxInstallments: recurring ? 1 : Number(form.maxInstallments) || 1,
        renewalMode: form.renewalMode,
        intervalType: form.intervalType,
        intervalCount: Number(form.intervalCount) || 1,
        trialDays: Number(form.trialDays) || 0,
        pricing,
      });
      setPreviewOpen(true);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : 'Não foi possível calcular os juros.',
      );
    } finally {
      setPreviewPending(false);
    }
  }

  const title = id ? 'Editar oferta' : 'Criar oferta';
  return (
    <ProductFormLayout path={listHref} listTitle="Ofertas" title={title}>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={previewPending}
          onClick={() => void openPreview()}
        >
          <Eye aria-hidden className="h-4 w-4" />
          {previewPending ? 'Calculando…' : 'Pré-visualizar'}
        </Button>
        <CoproductionButton
          product="ofertas"
          productId={id}
          draft={coproduction.participants}
          onDraftChange={coproduction.setParticipants}
          disabled={save.isPending}
        />
      </div>
      {previewOpen && (
        <PaymentLinkPreviewModal
          offerPreview
          onClose={() => setPreviewOpen(false)}
          draft={previewDraft!}
        />
      )}
      <ProductFormSection title="Básico">
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
        </div>
        <div className="mt-5">
          <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {id ? 'Tipo' : 'Modelo rápido'}
          </p>
          {id ? (
            <p className="text-sm" data-testid="offer-kind">
              {enumLabel(kindLabels, form.kind)}
              {offer?.platformTag
                ? ` · Plataforma ${offer.platformTag.toUpperCase()}`
                : ''}
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                O modelo preenche meios de pagamento e recorrência. Você ajusta
                tudo abaixo.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {OFFER_PRESET_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    data-testid={`preset-${kind}`}
                    aria-pressed={form.kind === kind}
                    onClick={() =>
                      setForm((current) => applyPreset(current, kind))
                    }
                    className={`cursor-pointer rounded-xl border p-3 text-left transition-colors hover:border-emerald-600 dark:hover:bg-white/5 ${
                      form.kind === kind
                        ? 'border-emerald-600 bg-emerald-50/60 dark:bg-white/5'
                        : 'border-zinc-200 dark:border-white/10'
                    }`}
                  >
                    <span className="block text-sm font-semibold">
                      {kindLabels[kind]}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
                      {kindDescriptions[kind]}
                    </span>
                    {kind !== 'BOLETO' && (
                      <span className="mt-1 block text-xs text-zinc-400">
                        {OFFER_PRESETS[kind].acceptedMethods
                          .map((method) => methodLabels[method])
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </ProductFormSection>

      {!id && (
        <ProductPlatformSection
          catalog={platformCatalog}
          value={platform}
          onChange={setPlatform}
          theme={theme}
        />
      )}

      <ProductFormSection title="Preço e pagamento">
        <div className="grid gap-4 md:grid-cols-2">
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
        <p className="mb-3 mt-5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Meios de pagamento aceitos
        </p>
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

      <ProductFormSection
        title="Recorrência"
        action={
          <FormSwitch
            aria-label="Oferta recorrente"
            aria-expanded={recurring}
            aria-controls="offer-recurrence-fields"
            checked={recurring}
            onChange={(on) =>
              patch({ renewalMode: on ? 'AUTO_CHARGE' : 'NONE' })
            }
          />
        }
      >
        {recurring && (
          <div
            id="offer-recurrence-fields"
            className="grid gap-4 md:grid-cols-2"
          >
            <Input
              label="A cada"
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              value={form.intervalCount}
              onChange={(value) => patch({ intervalCount: digitsOnly(value) })}
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
              label="Número de cobranças"
              placeholder="Até cancelar"
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              value={form.repetitions}
              onChange={(value) => patch({ repetitions: digitsOnly(value) })}
            />
            <Input
              label="Dias de teste grátis"
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              placeholder="Sem teste"
              value={form.trialDays}
              onChange={(value) => patch({ trialDays: digitsOnly(value) })}
            />
            <Input
              label="Dias entre retentativas"
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              placeholder="3"
              value={form.retryDays}
              onChange={(value) => patch({ retryDays: digitsOnly(value) })}
            />
            <Input
              label="Dias de carência"
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              placeholder="7"
              value={form.graceDays}
              onChange={(value) => patch({ graceDays: digitsOnly(value) })}
            />
          </div>
        )}
      </ProductFormSection>

      <OfferBumpsSection
        bumps={form.bumps}
        selfId={id}
        ownerUserId={user?.isAdmin ? offer?.ownerUserId : undefined}
        theme={theme}
        onChange={(bumps) => patch({ bumps })}
        onError={fail}
      />

      <ProductFormSection title="Validade e limites">
        <div className="grid gap-4 md:grid-cols-3">
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
          <Input
            label="Dias de acesso"
            theme={theme}
            variant="navbar"
            inputMode="numeric"
            placeholder="Sem prazo"
            value={form.accessDays}
            onChange={(value) => patch({ accessDays: digitsOnly(value) })}
          />
        </div>
      </ProductFormSection>

      <details className="group rounded-2xl border border-zinc-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-white/5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Entrega
            </span>
            <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">
              Configure o redirecionamento e o e-mail enviados após o pagamento.
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="px-5 pb-5">
          <div className="grid gap-4">
            <Input
              label="URL de redirecionamento após o pagamento"
              theme={theme}
              variant="navbar"
              placeholder="https://seusite.com/obrigado"
              value={form.redirectUrl}
              onChange={(redirectUrl) => patch({ redirectUrl })}
            />
            <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Mensagem do e-mail de entrega
              <textarea
                name="offer-email-body"
                className={textareaClass}
                placeholder="Texto enviado ao comprador depois de pago"
                value={form.emailBody}
                onChange={(event) => patch({ emailBody: event.target.value })}
              />
            </label>
          </div>
        </div>
      </details>

      {hasBoleto(form) && (
        <ProductFormSection title="Boleto">
          <div className="grid gap-4 md:grid-cols-2">
            <Input
              label={`Vencimento em dias (0 a ${MAX_BOLETO_DUE_DAYS})`}
              theme={theme}
              variant="navbar"
              inputMode="numeric"
              placeholder="Ex: 3"
              value={form.boletoDueDays}
              onChange={(value) => patch({ boletoDueDays: digitsOnly(value) })}
            />
          </div>
          <p
            role="note"
            className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {BOLETO_NOTE}
          </p>
        </ProductFormSection>
      )}

      <ProductFormActions
        path={listHref}
        pending={save.isPending}
        ready={platformReady}
        onSave={handleSave}
      />
    </ProductFormLayout>
  );
}

/** Formulário de criação/edição: busca a oferta (edição) e só então monta o estado local. */
export function OfferFormScreen({
  editId,
  listHref,
  onSaved,
}: {
  editId: string | null;
  listHref: string;
  onSaved: (id: string, opts: { coproductionFailed: boolean }) => void;
}) {
  const api = useClienteApi();
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: [OFFERS_QUERY_KEY, 'detail', user?.id, editId],
    enabled: Boolean(editId && user?.id),
    queryFn: () => api.get<Offer>(endpoints.ofertas.detail(editId!)),
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  if (editId && !query.data)
    return (
      <ProductEditState
        loading={query.isPending}
        retry={() => void query.refetch()}
      />
    );
  return (
    <FormBody
      key={editId ?? 'new'}
      offer={query.data ?? null}
      listHref={listHref}
      onSaved={onSaved}
    />
  );
}
