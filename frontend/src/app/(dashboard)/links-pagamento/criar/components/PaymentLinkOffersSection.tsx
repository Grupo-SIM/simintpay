'use client';

import {
  ArrowRight,
  ImagePlus,
  Mail,
  Paperclip,
  Plus,
  Rocket,
  ShoppingBag,
  Trash2,
  TrendingDown,
  X,
} from 'lucide-react';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type { ApiClient } from '@/services/api/api.client';
import {
  deletePaymentLinkOfferFile,
  savePaymentLinkOffers,
  uploadPaymentLinkOfferFiles,
  uploadPaymentLinkOfferImage,
  type SavePaymentLinkOfferInput,
} from '@/features/links-pagamento/services/links-pagamento.service';
import type {
  PaymentLinkFile,
  PaymentLinkOffer,
  PaymentLinkOfferType,
} from '../../types';

/** Deve casar com MAX_ORDER_BUMPS do backend. */
export const MAX_ORDER_BUMPS = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Devem casar com o backend (mensagem e PDFs de entrega por oferta). */
const EMAIL_BODY_MAX = 2000;
const MAX_PDF_FILES = 20;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

export type OfferDraft = {
  key: string;
  id?: string;
  tipo: PaymentLinkOfferType;
  chamada: string;
  titulo: string;
  descricao: string;
  imagemUrl: string | null;
  /** Imagem escolhida e ainda não enviada (o upload exige o link salvo). */
  imageFile: File | null;
  imagePreview: string | null;
  valor: string;
  valorOriginal: string;
  ativo: boolean;
  /** Mensagem do e-mail de entrega desta oferta (ex.: link de acesso). */
  mensagemEmail: string;
  /** PDFs já salvos; removidos só ao salvar o link. */
  arquivos: PaymentLinkFile[];
  removedFileIds: string[];
  /** PDFs escolhidos e ainda não enviados (o upload exige a oferta salva). */
  pendingFiles: File[];
};

function formatCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '0,00';
  const normalized = digits.padStart(3, '0');
  const cents = normalized.slice(-2);
  let integer = normalized.slice(0, -2).replace(/^0+(?=\d)/, '');
  if (!integer) integer = '0';
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${cents}`;
}

function parseCurrency(value: string) {
  return (
    Number(
      value
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^\d.]/g, ''),
    ) || 0
  );
}

function toCurrencyInput(value: number | null | undefined) {
  return value != null && value > 0
    ? formatCurrencyInput(String(Math.round(value * 100)))
    : '0,00';
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function createOfferDraft(tipo: PaymentLinkOfferType): OfferDraft {
  return {
    key: `oferta-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    tipo,
    chamada: '',
    titulo: '',
    descricao: '',
    imagemUrl: null,
    imageFile: null,
    imagePreview: null,
    valor: '0,00',
    valorOriginal: '0,00',
    ativo: true,
    mensagemEmail: '',
    arquivos: [],
    removedFileIds: [],
    pendingFiles: [],
  };
}

export function offerDraftsFromApi(
  ofertas: PaymentLinkOffer[] | undefined,
): OfferDraft[] {
  return (ofertas ?? []).map((o) => ({
    key: o.id,
    id: o.id,
    tipo: o.tipo,
    chamada: o.chamada ?? '',
    titulo: o.titulo,
    descricao: o.descricao ?? '',
    imagemUrl: o.imagemUrl,
    imageFile: null,
    imagePreview: null,
    valor: toCurrencyInput(o.valor),
    valorOriginal: toCurrencyInput(o.valorOriginal),
    ativo: o.ativo,
    mensagemEmail: o.mensagemEmail ?? '',
    arquivos: o.arquivos ?? [],
    removedFileIds: [],
    pendingFiles: [],
  }));
}

/** Retorna a mensagem do primeiro problema encontrado, ou null quando tudo está válido. */
export function validateOfferDrafts(drafts: OfferDraft[]): string | null {
  for (const d of drafts) {
    const label =
      d.tipo === 'ORDER_BUMP'
        ? 'order bump'
        : d.tipo === 'UPSELL'
          ? 'upsell'
          : 'downsell';
    if (!d.titulo.trim()) return `Informe o nome do produto do ${label}.`;
    const valor = parseCurrency(d.valor);
    if (valor <= 0) return `Informe o valor do ${label} "${d.titulo.trim()}".`;
    const original = parseCurrency(d.valorOriginal);
    if (original > 0 && original < valor)
      return `O valor "de" do ${label} "${d.titulo.trim()}" deve ser maior que o valor final.`;
  }
  if (
    drafts.some((d) => d.tipo === 'DOWNSELL') &&
    !drafts.some((d) => d.tipo === 'UPSELL')
  ) {
    return 'O downsell só é exibido quando o comprador recusa o upsell — configure um upsell.';
  }
  return null;
}

/** Envia imagens pendentes, sincroniza as ofertas do link e depois o material de entrega (PDFs). */
export async function persistOfferDrafts(
  api: ApiClient,
  linkId: string,
  drafts: OfferDraft[],
) {
  const ofertas: SavePaymentLinkOfferInput[] = [];
  for (const d of drafts) {
    const imagemUrl = d.imageFile
      ? await uploadPaymentLinkOfferImage(api, linkId, d.imageFile)
      : d.imagemUrl;
    const original = parseCurrency(d.valorOriginal);
    ofertas.push({
      id: d.id,
      tipo: d.tipo,
      chamada: d.chamada.trim() || null,
      titulo: d.titulo.trim(),
      descricao: d.descricao.trim() || null,
      imagemUrl: imagemUrl ?? null,
      mensagemEmail: d.mensagemEmail.trim() || null,
      valor: parseCurrency(d.valor),
      valorOriginal: original > 0 ? original : null,
      ativo: d.ativo,
    });
  }
  const saved = await savePaymentLinkOffers(api, linkId, ofertas);

  // Ofertas novas só têm id depois de salvas: casa por tipo + posição (mesma ordem enviada).
  const positions: Partial<Record<PaymentLinkOfferType, number>> = {};
  for (const d of drafts) {
    const position = (positions[d.tipo] = (positions[d.tipo] ?? -1) + 1);
    const offerId =
      d.id ??
      saved.data.find((s) => s.tipo === d.tipo && s.posicao === position)?.id;
    if (!offerId) continue;
    if (d.id) {
      for (const fileId of d.removedFileIds)
        await deletePaymentLinkOfferFile(api, linkId, offerId, fileId);
    }
    if (d.pendingFiles.length > 0)
      await uploadPaymentLinkOfferFiles(api, linkId, offerId, d.pendingFiles);
  }
  return saved;
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** Miniatura fiel ao bloco exibido no checkout. */
function OrderBumpPreview({ draft }: { draft: OfferDraft }) {
  const valor = parseCurrency(draft.valor);
  const original = parseCurrency(draft.valorOriginal);
  const image = draft.imagePreview ?? draft.imagemUrl;
  return (
    <div className="overflow-hidden rounded-lg border-2 border-dashed border-rose-400 bg-white text-zinc-800">
      {draft.chamada.trim() && (
        <div className="bg-rose-500 px-3 py-2 text-center text-xs font-bold uppercase tracking-wide text-white">
          {draft.chamada}
        </div>
      )}
      <div className="p-3">
        {draft.descricao.trim() && (
          <p className="mb-2 text-xs leading-relaxed text-zinc-600">
            {draft.descricao}
          </p>
        )}
        <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2.5">
          <ArrowRight className="h-4 w-4 shrink-0 text-rose-500" />
          <span className="h-4 w-4 shrink-0 rounded border-2 border-zinc-400 bg-white" />
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="h-12 w-12 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-zinc-200 text-zinc-400">
              <ShoppingBag className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 text-xs">
            <p className="text-zinc-600">Sim, quero adicionar</p>
            <p className="truncate font-bold">
              {draft.titulo.trim() || 'Nome do produto'}
            </p>
            <p>
              {original > valor && (
                <span className="mr-1 text-rose-500 line-through">
                  {fmt(original)}
                </span>
              )}
              <span className="text-zinc-500">por apenas </span>
              <span className="font-bold text-emerald-600">{fmt(valor)}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Material enviado por e-mail a quem comprar esta oferta. */
function OfferDeliveryEditor({
  draft,
  onChange,
  onError,
}: {
  draft: OfferDraft;
  onChange: (patch: Partial<OfferDraft>) => void;
  onError: (message: string) => void;
}) {
  const totalFiles = draft.arquivos.length + draft.pendingFiles.length;
  const fileRow =
    'flex items-center justify-between rounded-lg border px-3 py-2 text-sm';
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          <Mail className="h-4 w-4 text-emerald-600" />
          Entrega ao comprador
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {draft.tipo === 'ORDER_BUMP'
            ? 'Enviado junto com o e-mail do pedido, só para quem marcar este order bump.'
            : 'Enviado em um e-mail próprio, só para quem comprar esta oferta. O material do produto principal não é reenviado.'}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Mensagem do e-mail</FieldLabel>
        <textarea
          value={draft.mensagemEmail}
          onChange={(e) =>
            onChange({ mensagemEmail: e.target.value.slice(0, EMAIL_BODY_MAX) })
          }
          maxLength={EMAIL_BODY_MAX}
          rows={3}
          placeholder={'Ex: Aqui está o seu acesso: https://...'}
          className="w-full rounded-xl border border-zinc-200/80 bg-white p-3 text-sm text-zinc-800 outline-none transition-colors focus:border-emerald-500/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
        />
        <p className="text-right text-xs text-zinc-400">
          {draft.mensagemEmail.length}/{EMAIL_BODY_MAX}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <FieldLabel>
          Arquivos PDF ({totalFiles}/{MAX_PDF_FILES})
        </FieldLabel>
        {draft.arquivos.map((f) => (
          <div
            key={f.id}
            className={cn(
              fileRow,
              'border-zinc-200 bg-white dark:border-white/10 dark:bg-white/5',
            )}
          >
            <span className="flex min-w-0 items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <Paperclip className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="truncate">{f.fileName}</span>
              <span className="shrink-0 text-xs text-zinc-400">
                ({(f.fileSize / 1024 / 1024).toFixed(1)} MB)
              </span>
            </span>
            <button
              type="button"
              aria-label="Remover arquivo"
              className="ml-2 text-red-400 hover:text-red-600"
              onClick={() =>
                onChange({
                  arquivos: draft.arquivos.filter((x) => x.id !== f.id),
                  removedFileIds: [...draft.removedFileIds, f.id],
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {draft.pendingFiles.map((f, idx) => (
          <div
            key={`${f.name}-${idx}`}
            className={cn(
              fileRow,
              'border-emerald-200 bg-emerald-50 dark:border-emerald-800/30 dark:bg-emerald-900/10',
            )}
          >
            <span className="flex min-w-0 items-center gap-2 text-zinc-700 dark:text-zinc-300">
              <Paperclip className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-zinc-400">
                ({(f.size / 1024 / 1024).toFixed(1)} MB)
              </span>
            </span>
            <button
              type="button"
              aria-label="Remover arquivo"
              className="ml-2 text-red-400 hover:text-red-600"
              onClick={() =>
                onChange({
                  pendingFiles: draft.pendingFiles.filter((_, i) => i !== idx),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <label
          className={cn(
            'inline-flex w-fit items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors',
            totalFiles >= MAX_PDF_FILES
              ? 'cursor-not-allowed border-zinc-200 text-zinc-300 dark:border-white/10 dark:text-zinc-600'
              : 'cursor-pointer border-zinc-300 text-zinc-600 hover:border-emerald-400 hover:text-emerald-600 dark:border-white/20 dark:text-zinc-400',
          )}
        >
          <Paperclip className="h-4 w-4" />
          {totalFiles >= MAX_PDF_FILES
            ? 'Limite de PDFs atingido'
            : 'Adicionar PDF'}
          <input
            type="file"
            accept=".pdf,application/pdf"
            multiple
            disabled={totalFiles >= MAX_PDF_FILES}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              const tooBig = files.filter((f) => f.size > MAX_PDF_BYTES);
              if (tooBig.length > 0)
                onError(
                  `${tooBig.map((f) => f.name).join(', ')} excedem 25 MB e não foram adicionados.`,
                );
              const valid = files
                .filter((f) => f.size <= MAX_PDF_BYTES)
                .slice(0, Math.max(0, MAX_PDF_FILES - totalFiles));
              if (valid.length > 0)
                onChange({ pendingFiles: [...draft.pendingFiles, ...valid] });
            }}
          />
        </label>
      </div>
    </div>
  );
}

function OfferEditor({
  draft,
  theme,
  onChange,
  onRemove,
  onImageError,
}: {
  draft: OfferDraft;
  theme: 'light' | 'dark';
  onChange: (patch: Partial<OfferDraft>) => void;
  onRemove: () => void;
  onImageError: (message: string) => void;
}) {
  const image = draft.imagePreview ?? draft.imagemUrl;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 dark:border-white/10 dark:bg-white/2">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <Switch
            checked={draft.ativo}
            onChange={(v) => onChange({ ativo: v })}
          />
          {draft.ativo ? 'Ativo' : 'Inativo'}
        </label>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remover
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-[112px_1fr]">
        <div className="flex flex-col gap-1">
          <FieldLabel>Imagem</FieldLabel>
          <label className="group relative flex h-28 w-28 cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-white text-zinc-400 transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:border-white/20 dark:bg-white/5">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImagePlus className="h-6 w-6" />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > MAX_IMAGE_BYTES) {
                  onImageError('A imagem deve ter no máximo 5 MB.');
                  return;
                }
                onChange({
                  imageFile: file,
                  imagePreview: URL.createObjectURL(file),
                });
              }}
            />
          </label>
          {image && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  imageFile: null,
                  imagePreview: null,
                  imagemUrl: null,
                })
              }
              className="inline-flex w-28 items-center justify-center gap-1 text-xs text-zinc-500 hover:text-red-500"
            >
              <X className="h-3 w-3" /> Remover imagem
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Input
              label={
                draft.tipo === 'ORDER_BUMP'
                  ? 'Chamada em destaque (opcional)'
                  : 'Título da oferta (opcional)'
              }
              placeholder={
                draft.tipo === 'ORDER_BUMP'
                  ? 'Ex: POR QUE NÃO DOBRAR A SUA RENDA?'
                  : 'Ex: Espere! Oferta exclusiva para você'
              }
              value={draft.chamada}
              maxLength={120}
              onChange={(v) => onChange({ chamada: v })}
              theme={theme}
              variant="navbar"
            />
          </div>
          <div className="md:col-span-2">
            <Input
              label="Nome do produto"
              placeholder="Ex: Ebook Gatilhos Mentais"
              value={draft.titulo}
              maxLength={120}
              onChange={(v) => onChange({ titulo: v })}
              theme={theme}
              variant="navbar"
            />
          </div>
          <Input
            label="Valor da oferta"
            prefix="R$"
            value={draft.valor}
            onChange={(v) => onChange({ valor: formatCurrencyInput(v) })}
            theme={theme}
            variant="navbar"
          />
          <Input
            label={'Valor "de" riscado (opcional)'}
            prefix="R$"
            value={draft.valorOriginal}
            onChange={(v) =>
              onChange({ valorOriginal: formatCurrencyInput(v) })
            }
            theme={theme}
            variant="navbar"
          />
          <div className="flex flex-col gap-1 md:col-span-2">
            <FieldLabel>Descrição (opcional)</FieldLabel>
            <textarea
              value={draft.descricao}
              onChange={(e) =>
                onChange({ descricao: e.target.value.slice(0, 600) })
              }
              maxLength={600}
              rows={3}
              placeholder="Explique por que o comprador deve aproveitar esta oferta."
              className="w-full rounded-xl border border-zinc-200/80 bg-white p-3 text-sm text-zinc-800 outline-none transition-colors focus:border-emerald-500/50 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100"
            />
          </div>
        </div>
      </div>

      <OfferDeliveryEditor
        draft={draft}
        onChange={onChange}
        onError={onImageError}
      />

      {draft.tipo === 'ORDER_BUMP' && (
        <div className="flex flex-col gap-1">
          <FieldLabel>Prévia no checkout</FieldLabel>
          <OrderBumpPreview draft={draft} />
        </div>
      )}
    </div>
  );
}

export function PaymentLinkOffersSection({
  value,
  onChange,
  theme,
  onError,
}: {
  value: OfferDraft[];
  onChange: (next: OfferDraft[]) => void;
  theme: 'light' | 'dark';
  onError: (message: string) => void;
}) {
  const bumps = value.filter((d) => d.tipo === 'ORDER_BUMP');
  const upsell = value.find((d) => d.tipo === 'UPSELL') ?? null;
  const downsell = value.find((d) => d.tipo === 'DOWNSELL') ?? null;

  const patch = (key: string, p: Partial<OfferDraft>) =>
    onChange(value.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const remove = (key: string) => {
    const target = value.find((d) => d.key === key);
    // Sem upsell não há downsell: removê-lo leva o downsell junto.
    onChange(
      value.filter(
        (d) =>
          d.key !== key &&
          !(target?.tipo === 'UPSELL' && d.tipo === 'DOWNSELL'),
      ),
    );
  };
  const add = (tipo: PaymentLinkOfferType) =>
    onChange([...value, createOfferDraft(tipo)]);

  const cardClass =
    'rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5';

  return (
    <>
      <section className={cardClass}>
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <ShoppingBag className="h-4 w-4 text-emerald-600" />
            Order bumps
            <span className="text-xs font-normal text-zinc-400">
              ({bumps.length}/{MAX_ORDER_BUMPS})
            </span>
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ofertas exibidas no checkout, logo antes do pagamento. O comprador
            marca a caixa e o valor é somado ao pedido na mesma cobrança.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {bumps.map((d) => (
            <OfferEditor
              key={d.key}
              draft={d}
              theme={theme}
              onChange={(p) => patch(d.key, p)}
              onRemove={() => remove(d.key)}
              onImageError={onError}
            />
          ))}
          <button
            type="button"
            disabled={bumps.length >= MAX_ORDER_BUMPS}
            onClick={() => add('ORDER_BUMP')}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 py-2.5 text-sm text-zinc-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-zinc-300"
          >
            <Plus className="h-4 w-4" />
            {bumps.length >= MAX_ORDER_BUMPS
              ? 'Limite de order bumps atingido'
              : 'Adicionar order bump'}
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              <Rocket className="h-4 w-4 text-emerald-600" />
              Upsell
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Oferta exibida logo após o pagamento ser aprovado. No cartão, o
              comprador aceita com um clique (mesmo cartão); no PIX, um novo
              código é gerado.
            </p>
          </div>
          <Switch
            checked={Boolean(upsell)}
            onChange={(on) =>
              on ? add('UPSELL') : upsell && remove(upsell.key)
            }
          />
        </div>
        {upsell && (
          <OfferEditor
            draft={upsell}
            theme={theme}
            onChange={(p) => patch(upsell.key, p)}
            onRemove={() => remove(upsell.key)}
            onImageError={onError}
          />
        )}
      </section>

      <section className={cardClass}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
              <TrendingDown className="h-4 w-4 text-emerald-600" />
              Downsell
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {upsell
                ? 'Oferta alternativa (geralmente mais barata) exibida quando o comprador recusa o upsell.'
                : 'Configure um upsell para habilitar o downsell.'}
            </p>
          </div>
          <Switch
            checked={Boolean(downsell)}
            disabled={!upsell}
            onChange={(on) =>
              on ? add('DOWNSELL') : downsell && remove(downsell.key)
            }
          />
        </div>
        {downsell && (
          <OfferEditor
            draft={downsell}
            theme={theme}
            onChange={(p) => patch(downsell.key, p)}
            onRemove={() => remove(downsell.key)}
            onImageError={onError}
          />
        )}
      </section>
    </>
  );
}
