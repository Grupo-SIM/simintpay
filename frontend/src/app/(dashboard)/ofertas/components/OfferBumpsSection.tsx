'use client';

import { useState } from 'react';
import { PaymentLinkPreviewModal } from './PaymentLinkPreviewModal';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ExternalLink, Eye, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown } from '@/components/ui/Dropdown';
import { FormSwitch } from '@/components/ui/FormSwitch';
import { Button } from '@/components/ui/Button';
import { PortalTooltip } from '@/components/ui/PortalTooltip';
import { useCurrentUser } from '@/hooks/use-current-user';
import { getDefaultApiBaseUrl } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import {
  DebouncedInput as Input,
  ProductFormSection,
} from '../../cliente/components';
import {
  fmtBRL,
  formatCurrencyFromNumber,
  parseCurrencyInput,
  useClienteApi,
} from '../../cliente/_shared';
import {
  BUMP_ROLES,
  MAX_COUNTDOWN_SECONDS,
  MAX_HEADLINE,
  MAX_ORDER_BUMPS,
  MIN_COUNTDOWN_SECONDS,
  addBump,
  bumpCandidates,
  bumpEntryProblem,
  bumpRoleLabels,
  bumpRoleLimits,
  digitsOnly,
  moveBump,
  patchBump,
  removeBump,
  setBumpRole,
  type BumpRole,
  type FormBump,
} from '../offer-form';
import {
  normalizeListResponse,
  type OfferListResponse,
} from '../offer-filters';
import { OFFERS_QUERY_KEY, type Offer } from '../offers';

/** Rota pública da imagem da oferta, ou null quando ela não tem imagem. */
function publicImageOf(offer: Offer): string | null {
  const image = (offer.fulfillment ?? {}).imageUrl;
  if (typeof image !== 'string' || !image) return null;
  return `${getDefaultApiBaseUrl()}${endpoints.ofertas.publicImage(offer.code)}`;
}

/** Resumo dos PDFs da oferta ligada (e-mail e PDFs vivem na própria oferta). */
function FilesSummary({ offerId }: { offerId: string }) {
  const api = useClienteApi();
  const files = useQuery({
    queryKey: [OFFERS_QUERY_KEY, 'files', offerId],
    queryFn: () =>
      api.get<{ files: { id: string }[] }>(endpoints.ofertas.files(offerId)),
  });
  if (files.isPending) return <>carregando PDFs...</>;
  if (files.isError) return <>PDFs indisponíveis</>;
  const count = files.data.files.length;
  return (
    <>{count === 0 ? 'sem PDFs' : `${count} PDF${count > 1 ? 's' : ''}`}</>
  );
}

export function OfferBumpsSection({
  bumps,
  selfId,
  ownerUserId,
  theme,
  onChange,
  onError,
  onPreviewBumps,
  bumpPreviewPending = false,
}: {
  bumps: FormBump[];
  selfId: string | null;
  /** Admin editando oferta de outro titular: os candidatos são desse titular. */
  ownerUserId?: string;
  theme: 'light' | 'dark';
  onChange: (bumps: FormBump[]) => void;
  onError: (message: string) => void;
  /** Abre a prévia do checkout da oferta, com os order bumps. */
  onPreviewBumps: () => void;
  bumpPreviewPending?: boolean;
}) {
  const api = useClienteApi();
  const [previewDraft, setPreviewDraft] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  async function previewFunnel() {
    if (previewPending) return;
    setPreviewPending(true);
    try {
      const selected = bumps.filter(
        (bump) => bump.role !== 'BUMP' && bump.isActive !== false,
      );
      const offers = await Promise.all(
        selected.map((bump) =>
          api.get<Offer>(endpoints.ofertas.detail(bump.offerId)),
        ),
      );
      if (
        offers.some((offer) => !offer.isActive || offer.renewalMode !== 'NONE')
      ) {
        onError(
          'O funil contém uma oferta inativa ou recorrente. Atualize as ofertas para pré-visualizar.',
        );
        return;
      }
      setPreviewDraft({
        offers: selected.map((bump, index) => ({
          id: bump.offerId,
          role: bump.role,
          name: offers[index].name,
          description: offers[index].description,
          amountCents: offers[index].amountCents,
          imageUrl: publicImageOf(offers[index]),
          headline: bump.headline?.trim() || null,
          originalAmountCents:
            bump.originalAmountCents != null &&
            bump.originalAmountCents > offers[index].amountCents
              ? bump.originalAmountCents
              : null,
          countdownSeconds: bump.countdownSeconds ?? null,
        })),
      });
    } catch {
      onError(
        'Não foi possível carregar as ofertas do funil. Tente novamente.',
      );
    } finally {
      setPreviewPending(false);
    }
  }
  const { user } = useCurrentUser();
  const query = useQuery({
    queryKey: [OFFERS_QUERY_KEY, 'bump-candidates', user?.id, ownerUserId],
    enabled: Boolean(user?.id),
    queryFn: async () =>
      normalizeListResponse(
        await api.get<OfferListResponse | Offer[]>(endpoints.ofertas.list, {
          query: {
            page: 1,
            pageSize: 100,
            sort: 'name',
            status: 'ACTIVE',
            renewalMode: 'NONE',
            ...(ownerUserId ? { ownerUserId } : {}),
          },
        }),
        { page: 1 },
      ),
  });
  const offers = query.data?.data ?? [];
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const candidates = bumpCandidates(offers, selfId, bumps);

  const setRole = (offerId: string, role: BumpRole) => {
    const result = setBumpRole(bumps, offerId, role);
    if ('error' in result) return onError(result.error);
    onChange(result.bumps);
  };
  const patch = (offerId: string, fields: Parameters<typeof patchBump>[2]) =>
    onChange(patchBump(bumps, offerId, fields));
  const countOf = (role: BumpRole) =>
    bumps.filter((bump) => bump.role === role).length;

  const hasUpsell = bumps.some((bump) => bump.role === 'UPSELL');
  const hasBump = bumps.some((bump) => bump.role === 'BUMP');

  return (
    <ProductFormSection
      title="Funil"
      action={
        <div className="flex flex-wrap gap-2">
          <PortalTooltip
            content={
              hasBump ? null : (
                <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
                  Adicione um order bump para pré-visualizar
                </div>
              )
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={bumpPreviewPending || !hasBump}
              onClick={onPreviewBumps}
            >
              <Eye aria-hidden className="h-4 w-4" />
              {bumpPreviewPending ? 'Calculando…' : 'Pré-visualizar order bump'}
            </Button>
          </PortalTooltip>
          <PortalTooltip
            content={
              hasUpsell ? null : (
                <div className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
                  Adicione um upsell para pré-visualizar
                </div>
              )
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={previewPending || !hasUpsell}
              onClick={() => void previewFunnel()}
            >
              <Eye aria-hidden className="h-4 w-4" />
              {previewPending ? 'Carregando...' : 'Pré-visualizar funil'}
            </Button>
          </PortalTooltip>
        </div>
      }
    >
      {previewDraft && (
        <PaymentLinkPreviewModal
          funnelPreview
          draft={previewDraft}
          onClose={() => setPreviewDraft(null)}
        />
      )}
      <div className="flex flex-col gap-4" data-testid="bumps-section">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ofereça outras ofertas ativas de compra única no checkout. Limites:
          order bumps {countOf('BUMP')}/{MAX_ORDER_BUMPS}, upsell{' '}
          {countOf('UPSELL')}/1 e downsell {countOf('DOWNSELL')}/1; o downsell
          exige um upsell. A ordem da lista é a ordem no checkout e remover uma
          linha tira a oferta do funil.
        </p>
        {bumps.length > 0 && (
          <ul className="flex flex-col gap-2">
            {bumps.map((bump, index) => {
              const offer = byId.get(bump.offerId);
              const funnel = bump.role !== 'BUMP';
              const active = bump.isActive !== false;
              const problem = bumpEntryProblem(bump, offer?.amountCents);
              const errorFor = (needle: RegExp) =>
                problem && needle.test(problem) ? problem : undefined;
              const roleFull = (role: BumpRole) =>
                role !== bump.role && countOf(role) >= bumpRoleLimits[role];
              return (
                <li
                  key={bump.offerId}
                  data-testid="bump-row"
                  className={`flex flex-col gap-3 rounded-xl border border-zinc-200 p-3 dark:border-white/10 ${active ? '' : 'opacity-70'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block truncate font-medium">
                        {offer?.name ?? `Oferta ${bump.offerId.slice(0, 8)}`}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {offer ? (
                          <>
                            {fmtBRL(offer.amountCents / 100)} ·{' '}
                            <FilesSummary offerId={offer.id} /> ·{' '}
                            {(offer.fulfillment ?? {}).emailBody
                              ? 'e-mail personalizado'
                              : 'e-mail padrão'}
                          </>
                        ) : query.isPending ? (
                          'Carregando...'
                        ) : (
                          'Indisponível (inativa ou recorrente)'
                        )}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">
                        {active ? 'Ativo' : 'Inativo'}
                      </span>
                      <FormSwitch
                        aria-label="Ativo"
                        checked={active}
                        onChange={(on) =>
                          patch(bump.offerId, {
                            isActive: on ? undefined : false,
                          })
                        }
                      />
                    </div>
                    <div className="w-44">
                      <Dropdown
                        theme={theme}
                        variant="navbar"
                        value={bump.role}
                        onChange={(role) =>
                          setRole(bump.offerId, role as BumpRole)
                        }
                        options={BUMP_ROLES.map((role) => ({
                          value: role,
                          label: roleFull(role)
                            ? `${bumpRoleLabels[role]} (limite atingido)`
                            : bumpRoleLabels[role],
                        }))}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Subir"
                      className="cursor-pointer"
                      disabled={index === 0}
                      onClick={() =>
                        onChange(moveBump(bumps, bump.offerId, -1))
                      }
                    >
                      <ArrowUp aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Descer"
                      className="cursor-pointer"
                      disabled={index === bumps.length - 1}
                      onClick={() => onChange(moveBump(bumps, bump.offerId, 1))}
                    >
                      <ArrowDown aria-hidden className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Remover"
                      className="cursor-pointer"
                      onClick={() => onChange(removeBump(bumps, bump.offerId))}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" />
                    </Button>
                  </div>
                  <div
                    className={`grid gap-3 ${funnel ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
                  >
                    <Input
                      label="Chamada em destaque"
                      theme={theme}
                      variant="navbar"
                      placeholder="Opcional"
                      maxLength={MAX_HEADLINE}
                      value={bump.headline ?? ''}
                      error={errorFor(/chamada/)}
                      onChange={(headline) => patch(bump.offerId, { headline })}
                    />
                    <Input
                      label='Valor "de" (riscado)'
                      theme={theme}
                      variant="navbar"
                      prefix="R$"
                      placeholder="Opcional"
                      inputMode="decimal"
                      value={
                        bump.originalAmountCents
                          ? formatCurrencyFromNumber(
                              bump.originalAmountCents / 100,
                            )
                          : ''
                      }
                      error={errorFor(/"de"/)}
                      onChange={(value) => {
                        const cents = Math.round(
                          parseCurrencyInput(value) * 100,
                        );
                        patch(bump.offerId, {
                          originalAmountCents: cents > 0 ? cents : null,
                        });
                      }}
                    />
                    {funnel && (
                      <Input
                        label="Cronômetro (segundos)"
                        theme={theme}
                        variant="navbar"
                        placeholder={`Opcional, ${MIN_COUNTDOWN_SECONDS} a ${MAX_COUNTDOWN_SECONDS}`}
                        inputMode="numeric"
                        value={
                          bump.countdownSeconds == null
                            ? ''
                            : String(bump.countdownSeconds)
                        }
                        error={errorFor(/cronômetro/)}
                        onChange={(value) => {
                          const digits = digitsOnly(value);
                          patch(bump.offerId, {
                            countdownSeconds: digits ? Number(digits) : null,
                          });
                        }}
                      />
                    )}
                  </div>
                  {offer && (
                    <p className="text-xs text-zinc-500">
                      Nome, preço, imagem, e-mail e PDFs são da própria oferta e
                      valem em todos os lugares onde ela é vendida.{' '}
                      <Link
                        href={`/ofertas/${encodeURIComponent(offer.id)}/editar`}
                        target="_blank"
                        className="inline-flex items-center gap-1 underline"
                      >
                        Editar oferta
                        <ExternalLink aria-hidden className="h-3 w-3" />
                      </Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {query.isError ? (
          <p role="alert" className="text-sm text-red-600">
            Não foi possível carregar as ofertas disponíveis.{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => void query.refetch()}
            >
              Tentar novamente
            </button>
          </p>
        ) : (
          <Dropdown
            label="Adicionar oferta"
            theme={theme}
            variant="navbar"
            searchable
            searchPlaceholder="Buscar oferta"
            placeholder={
              query.isPending
                ? 'Carregando...'
                : candidates.length
                  ? 'Selecione uma oferta'
                  : 'Nenhuma oferta avulsa ativa disponível'
            }
            disabled={candidates.length === 0}
            value=""
            onChange={(offerId) => {
              const result = addBump(bumps, offerId, 'BUMP');
              if ('error' in result) return onError(result.error);
              onChange(result.bumps);
            }}
            options={candidates.map((offer) => ({
              value: offer.id,
              label: `${offer.name} · ${fmtBRL(offer.amountCents / 100)}`,
            }))}
          />
        )}
      </div>
    </ProductFormSection>
  );
}
