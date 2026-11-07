'use client';

import { useState } from 'react';
import { PaymentLinkPreviewModal } from '../../links-pagamento/criar/components/PaymentLinkPreviewModal';
import { Eye, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Dropdown } from '@/components/ui/Dropdown';
import { Button } from '@/components/ui/Button';
import { useCurrentUser } from '@/hooks/use-current-user';
import { endpoints } from '@/services/api/endpoints';
import { ProductFormSection } from '../../cliente/components';
import { fmtBRL, useClienteApi } from '../../cliente/_shared';
import {
  BUMP_ROLES,
  addBump,
  bumpCandidates,
  bumpRoleLabels,
  removeBump,
  type BumpRole,
  type FormBump,
} from '../offer-form';
import {
  normalizeListResponse,
  type OfferListResponse,
} from '../offer-filters';
import { OFFERS_QUERY_KEY, type Offer } from '../offers';

export function OfferBumpsSection({
  bumps,
  selfId,
  ownerUserId,
  theme,
  onChange,
  onError,
}: {
  bumps: FormBump[];
  selfId: string | null;
  /** Admin editando oferta de outro titular: os candidatos são desse titular. */
  ownerUserId?: string;
  theme: 'light' | 'dark';
  onChange: (bumps: FormBump[]) => void;
  onError: (message: string) => void;
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
      const selected = bumps.filter((bump) => bump.role !== 'BUMP');
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
    const rest = removeBump(bumps, offerId);
    const result = addBump(rest, offerId, role);
    if ('error' in result) return onError(result.error);
    // Mantém a posição da linha ao trocar o papel.
    onChange(
      bumps.map(
        (bump) => result.bumps.find((b) => b.offerId === bump.offerId) ?? bump,
      ),
    );
  };

  return (
    <ProductFormSection
      title="Funil"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={
            previewPending || !bumps.some((bump) => bump.role === 'UPSELL')
          }
          onClick={() => void previewFunnel()}
        >
          <Eye aria-hidden className="h-4 w-4" />
          {previewPending ? 'Carregando...' : 'Pré-visualizar funil'}
        </Button>
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
          Ofereça outras ofertas ativas de compra única no checkout. Obs:
          downsell exige no mínimo um upsell
        </p>
        {bumps.length > 0 && (
          <ul className="flex flex-col gap-2">
            {bumps.map((bump) => {
              const offer = byId.get(bump.offerId);
              return (
                <li
                  key={bump.offerId}
                  data-testid="bump-row"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-white/10"
                >
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">
                      {offer?.name ?? `Oferta ${bump.offerId.slice(0, 8)}`}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {offer
                        ? fmtBRL(offer.amountCents / 100)
                        : query.isPending
                          ? 'Carregando...'
                          : 'Indisponível (inativa ou recorrente)'}
                    </span>
                  </span>
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
                        label: bumpRoleLabels[role],
                      }))}
                    />
                  </div>
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
