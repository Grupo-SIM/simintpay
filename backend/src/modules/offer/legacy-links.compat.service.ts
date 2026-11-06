import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Offer } from '@prisma/client';
import type { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import type { ListPaymentLinksQueryDto } from '../../application/dtos/payment-link/list-payment-links.query.dto';
import type { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import type { CreateSubscriptionLinkDto } from '../../application/dtos/subscription-link/create-subscription-link.dto';
import type { UpdateSubscriptionLinkDto } from '../../application/dtos/subscription-link/update-subscription-link.dto';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { coproductionInfo } from '../coproduction/coproduction-view';
import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import {
  paymentLinkCreated,
  paymentLinkDetail,
  paymentLinkListItem,
  paymentLinkToCreateOffer,
  paymentLinkToUpdateOffer,
  subscriptionLinkCreated,
  subscriptionLinkDetail,
  subscriptionLinkListItem,
  subscriptionLinkPublic,
  subscriptionLinkToCreateOffer,
  subscriptionLinkToUpdateOffer,
  subscriptionLinkUpdated,
} from './legacy-links.compat';
import { OfferService, type OfferActor } from './offer.service';

type Kind = 'payment' | 'subscription';
type ListInput = { page?: number; pageSize?: number; onlyMine?: boolean };

const NOT_FOUND: Record<Kind, string> = {
  payment: 'Link não encontrado',
  subscription: 'Link de assinatura não encontrado',
};

/** A payment link is a one-off offer; a subscription link is any recurring one. */
const matches = (kind: Kind, offer: Offer) =>
  (kind === 'payment') === (offer.renewalMode === 'NONE');

/**
 * Legacy `/links-pagamento` and `/links-assinatura` behavior on top of `Offer`. All writes go
 * through `OfferService`, so ownership, minimum amount, platform and delivery rules are the
 * native ones; this class only translates shapes and legacy error messages.
 */
@Injectable()
export class LegacyLinksCompatService {
  constructor(
    private readonly offers: OfferService,
    private readonly prisma: PrismaService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  // ── Payment links ─────────────────────────────────────────────────────────

  async createPaymentLink(actor: OfferActor, dto: CreatePaymentLinkDto) {
    const ownerUserId = await this.resolveOwner(dto);
    const offer = await this.offers.create(
      actor,
      paymentLinkToCreateOffer(dto, ownerUserId),
    );
    return { data: paymentLinkCreated(offer) };
  }

  async listPaymentLinks(actor: OfferActor, query: ListPaymentLinksQueryDto) {
    return this.list(actor, 'payment', query, paymentLinkListItem);
  }

  async getPaymentLink(actor: OfferActor, id: string) {
    const offer = await this.owned(actor, id, 'payment');
    return { data: paymentLinkDetail(offer) };
  }

  async updatePaymentLink(
    actor: OfferActor,
    id: string,
    dto: UpdatePaymentLinkDto,
  ) {
    const existing = await this.owned(actor, id, 'payment');
    const offer = await this.offers.update(
      actor,
      id,
      paymentLinkToUpdateOffer(dto, existing),
    );
    return { data: paymentLinkCreated(offer) };
  }

  async deletePaymentLink(actor: OfferActor, id: string) {
    await this.owned(actor, id, 'payment');
    await this.offers.deactivate(actor, id);
    return { deleted: true as const };
  }

  // ── Subscription links ────────────────────────────────────────────────────

  async createSubscriptionLink(
    actor: OfferActor,
    dto: CreateSubscriptionLinkDto,
  ) {
    const ownerUserId = await this.resolveOwner(dto);
    const offer = await this.offers.create(
      actor,
      subscriptionLinkToCreateOffer(dto, ownerUserId),
    );
    return { data: subscriptionLinkCreated(offer) };
  }

  async listSubscriptionLinks(actor: OfferActor, query: ListInput) {
    return this.list(actor, 'subscription', query, subscriptionLinkListItem);
  }

  async getSubscriptionLink(actor: OfferActor, id: string) {
    const offer = await this.owned(actor, id, 'subscription');
    const owner = await this.prisma.user.findUnique({
      where: { id: offer.ownerUserId },
      select: { email: true },
    });
    return { data: subscriptionLinkDetail(offer, owner?.email ?? null) };
  }

  async updateSubscriptionLink(
    actor: OfferActor,
    id: string,
    dto: UpdateSubscriptionLinkDto,
  ) {
    const existing = await this.owned(actor, id, 'subscription');
    const offer = await this.offers.update(
      actor,
      id,
      subscriptionLinkToUpdateOffer(dto, existing),
    );
    return { data: subscriptionLinkUpdated(offer) };
  }

  async deleteSubscriptionLink(actor: OfferActor, id: string) {
    await this.owned(actor, id, 'subscription');
    await this.offers.deactivate(actor, id);
    return { deleted: true as const };
  }

  /** Public checkout read by offer code (the legacy route took the subscription link code). */
  async getPublicSubscriptionLink(code: string) {
    const row = await this.prisma.offer.findFirst({
      where: { OR: [{ code }, { id: code }] },
    });
    if (!row || row.renewalMode === 'NONE')
      throw new NotFoundException(
        'Link de assinatura não encontrado ou inativo',
      );
    // Availability (active, not expired, uses left) is the offer's own rule.
    await this.offers.getPublicByCode(row.code);
    const platformTag = (row.platformTag ?? 'GLOBAL').toUpperCase();
    const context = await loadChargePolicy(this.prisma, platformTag);
    const base = row.amountCents / 100;
    return subscriptionLinkPublic(
      row,
      quoteFinancialCharge(context, base, 'CREDIT_CARD'),
      quoteFinancialCharge(context, base, 'PIX'),
      platformTag,
    );
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /** Admin-on-behalf creation: `email` and `ownerUserId` must point at the same account. */
  private async resolveOwner(dto: {
    ownerUserId?: string;
    email?: string;
  }): Promise<string | undefined> {
    if (!dto.email) return dto.ownerUserId;
    const byEmail = await this.users.findByEmail(dto.email);
    if (!byEmail || (dto.ownerUserId && dto.ownerUserId !== byEmail.id))
      throw new BadRequestException('Destinatários conflitantes');
    return byEmail.id;
  }

  /** Owner-scoped read with the legacy 404 text; the wrong product type is also a 404. */
  private async owned(
    actor: OfferActor,
    id: string,
    kind: Kind,
  ): Promise<Offer> {
    let offer: Offer;
    try {
      offer = await this.offers.get(actor, id);
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new NotFoundException(NOT_FOUND[kind]);
      throw error;
    }
    if (!matches(kind, offer)) throw new NotFoundException(NOT_FOUND[kind]);
    return offer;
  }

  private async list<T>(
    actor: OfferActor,
    kind: Kind,
    input: ListInput,
    item: (offer: Offer, owner: OwnerRow | null, coproducao: unknown) => T,
  ) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const scope =
      actor.role === 'ADMIN' && input.onlyMine ? { ownerUserId: actor.id } : {};
    const modes =
      kind === 'payment'
        ? (['NONE'] as const)
        : (['AUTO_CHARGE', 'MANUAL_PAY'] as const);
    const lists = await Promise.all(
      modes.map(
        (renewalMode) =>
          this.offers.list(actor, { ...scope, renewalMode }) as Promise<
            Offer[]
          >,
      ),
    );
    const all = lists
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = all.slice((page - 1) * pageSize, page * pageSize);

    const owners = new Map<string, OwnerRow>(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...new Set(items.map((o) => o.ownerUserId))] } },
          select: {
            id: true,
            cpf: true,
            name: true,
            email: true,
            clientStatus: true,
          },
        })
      ).map((u) => [u.id, u]),
    );
    const coproducao = await coproductionInfo(
      this.prisma,
      'ofertas',
      actor.id,
      items.map((o) => ({ id: o.id, userId: o.ownerUserId })),
    );
    return {
      data: items.map((o) =>
        item(o, owners.get(o.ownerUserId) ?? null, coproducao.get(o.id)),
      ),
      page,
      pageSize,
      total: all.length,
    };
  }
}

type OwnerRow = {
  id: string;
  cpf: string | null;
  name: string | null;
  email: string | null;
  clientStatus: string | null;
};
