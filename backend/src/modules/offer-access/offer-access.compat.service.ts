import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type Offer,
  type OfferAccess,
  type OfferCodeAlias,
} from '@prisma/client';
import { assertExplicitPlatform } from '../../application/helpers/explicit-platform.helper';
import { accessDaysForFrequency } from '../../application/helpers/billing-frequency.helper';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { signRenewal } from '../billing-core/renewal-signature';
import { coproductionInfo } from '../coproduction/coproduction-view';
import { OfferRenewalService } from '../offer/offer-renewal.service';
import { OfferSubscribeService } from '../offer/offer-subscribe.service';
import { OfferService, type OfferActor } from '../offer/offer.service';
import {
  readOfferFulfillment,
  unsafeUrlReason,
} from '../offer/offer-fulfillment';
import type { CreateOfferDto } from '../offer/offer.dto';
import { generatePixAliasCode } from './find-offer-by-alias';
import { isEffectivelyActive, remainingDaysOf } from './offer-access.math';
import { OfferAccessService } from './offer-access.service';

/** Frequência do plano PIX legado -> tipo do enum `PlanType` e recorrência da oferta. */
export type PixFrequency = 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR';
export type LegacyPlanType = 'MONTHLY' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

const FREQUENCY: Record<
  PixFrequency,
  {
    type: LegacyPlanType;
    intervalType: 'MONTH' | 'YEAR';
    intervalCount: number;
  }
> = {
  MONTH: { type: 'MONTHLY', intervalType: 'MONTH', intervalCount: 1 },
  QUARTER: { type: 'TRIMESTRAL', intervalType: 'MONTH', intervalCount: 3 },
  SEMESTER: { type: 'SEMESTRAL', intervalType: 'MONTH', intervalCount: 6 },
  YEAR: { type: 'ANUAL', intervalType: 'YEAR', intervalCount: 1 },
};

const PLAN_TYPE_TO_FREQUENCY: Record<string, PixFrequency> = {
  MONTHLY: 'MONTH',
  TRIMESTRAL: 'QUARTER',
  SEMESTRAL: 'SEMESTER',
  ANUAL: 'YEAR',
};

/** Marca em `Offer.metadata.pixPlan` das ofertas criadas pelas rotas de compatibilidade. */
type PixPlanMeta = {
  /** PLAN: plano criado por `POST payments/pix-plan`; ADHOC: oferta do `pix-plan/checkout`; DELETED. */
  kind: 'PLAN' | 'ADHOC' | 'DELETED';
  webhookUrl?: string | null;
  /** ADHOC: `<ownerUserId>:<planType>:<amountCents>`, a chave de reaproveitamento da oferta. */
  adhocKey?: string;
};

const metaOf = (offer: Pick<Offer, 'metadata'>): PixPlanMeta | null => {
  const raw = (offer.metadata ?? {}) as { pixPlan?: PixPlanMeta };
  return raw.pixPlan ?? null;
};

export function frequencyOfOffer(
  offer: Pick<Offer, 'intervalType' | 'intervalCount'>,
): PixFrequency {
  if (offer.intervalType === 'YEAR') return 'YEAR';
  if (offer.intervalCount === 6) return 'SEMESTER';
  if (offer.intervalCount === 3) return 'QUARTER';
  return 'MONTH';
}

export const planTypeOfOffer = (
  offer: Pick<Offer, 'intervalType' | 'intervalCount'>,
): LegacyPlanType => FREQUENCY[frequencyOfOffer(offer)].type;

export function mapFrequencyToType(freq?: string): LegacyPlanType {
  return FREQUENCY[(freq as PixFrequency) ?? 'MONTH']?.type ?? 'MONTHLY';
}

/** Linha de `PixCreditPlan` como o legado devolvia (usada por criação e detalhe). */
export function toLegacyPlanRow(offer: Offer) {
  const fulfillment = readOfferFulfillment(offer.fulfillment);
  return {
    createdByUserId: offer.createdByUserId,
    id: offer.id,
    userId: offer.ownerUserId,
    type: planTypeOfOffer(offer),
    price: offer.amountCents / 100,
    description: offer.description ?? offer.name,
    redirectUrl: fulfillment.redirectUrl,
    webhookUrl: metaOf(offer)?.webhookUrl ?? null,
    status: offer.isActive ? 'ACTIVE' : 'INACTIVE',
    emailBody: fulfillment.emailBody,
    tenantTag: offer.platformTag,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
}

/** `tenantTag` exibido na lista: CLIENT:<email> e GLOBAL aparecem como SIMINTPAY (como no legado). */
export const displayTenantTag = (tag: string | null): string | null => {
  const raw = tag ? tag.toUpperCase() : null;
  return raw?.startsWith('CLIENT:') || raw === 'GLOBAL' ? 'SIMINTPAY' : raw;
};

const ACTOR = (userId: string, role?: string): OfferActor => ({
  id: userId,
  role: role ?? 'USER',
});

export type CompatAccessListParams = {
  page: number;
  limit: number;
  userId?: string;
  isActive?: boolean;
  pixPlanId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

/**
 * Rotas de compatibilidade do plano PIX de crédito para o api-pagatg, apoiadas em
 * Offer / OfferAccess / OfferCodeAlias. Cada método devolve o mesmo JSON do `PixPlanService`.
 */
@Injectable()
export class OfferAccessCompatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly offers: OfferService,
    private readonly subscriptions: OfferSubscribeService,
    private readonly renewals: OfferRenewalService,
    private readonly access: OfferAccessService,
  ) {}

  // ── Planos ──────────────────────────────────────────────────────────────

  private async ownedPlan(userId: string, id: string, role?: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || metaOf(offer)?.kind !== 'PLAN')
      throw new NotFoundException('Plano PIX não encontrado');
    if (role !== 'ADMIN' && offer.ownerUserId !== userId)
      throw new BadRequestException('Plano não pertence a este usuário');
    return offer;
  }

  private async createOffer(
    actor: OfferActor,
    input: {
      ownerUserId?: string;
      name: string;
      description?: string;
      amountCents: number;
      frequency: PixFrequency;
      platformTag?: string;
      redirectUrl?: string | null;
      emailBody?: string | null;
      meta: PixPlanMeta;
    },
  ): Promise<Offer> {
    const freq = FREQUENCY[input.frequency];
    const fulfillment: Record<string, string> = {};
    if (input.redirectUrl) fulfillment.redirectUrl = input.redirectUrl;
    if (input.emailBody) fulfillment.emailBody = input.emailBody;
    const dto = {
      // `kind` some quando o enum OfferKind for removido; remover esta linha junto.
      kind: 'PIX_PLAN',
      ownerUserId: input.ownerUserId,
      platformTag: input.platformTag,
      name: input.name.slice(0, 120),
      description: input.description,
      amountCents: input.amountCents,
      acceptedMethods: ['PIX'],
      maxInstallments: 1,
      renewalMode: 'MANUAL_PAY',
      intervalType: freq.intervalType,
      intervalCount: freq.intervalCount,
      accessDays: accessDaysForFrequency(freq.type),
      fulfillment: Object.keys(fulfillment).length ? fulfillment : undefined,
      metadata: { pixPlan: input.meta },
    } as unknown as CreateOfferDto;
    return this.offers.create(actor, dto);
  }

  private async newAlias(offerId: string): Promise<OfferCodeAlias> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.offerCodeAlias.create({
          data: { offerId, kind: 'PX', code: generatePixAliasCode() },
        });
      } catch (error) {
        const collision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!collision || attempt === 4) throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** POST payments/pix-plan */
  async createPlan(
    userId: string,
    role: string | undefined,
    body: {
      ownerUserId?: string;
      price: number;
      description: string;
      redirectUrl?: string;
      webhookUrl?: string;
      frequency_type?: PixFrequency;
      tenantTag?: string;
      emailBody?: string;
    },
  ) {
    const offer = await this.createOffer(ACTOR(userId, role), {
      ownerUserId: body.ownerUserId,
      name: body.description,
      description: body.description,
      amountCents: Math.round(body.price * 100),
      frequency: body.frequency_type ?? 'MONTH',
      platformTag: body.tenantTag,
      redirectUrl: body.redirectUrl,
      emailBody: body.emailBody ?? null,
      meta: { kind: 'PLAN', webhookUrl: body.webhookUrl ?? null },
    });
    const alias = await this.newAlias(offer.id);
    return { ...toLegacyPlanRow(offer), linkCode: alias.code };
  }

  /** POST payments/pix-plan/:id/link-code */
  async createLinkCode(userId: string, id: string, role?: string) {
    const offer = await this.ownedPlan(userId, id, role);
    if (!offer.isActive)
      throw new NotFoundException('Plano PIX não encontrado ou inativo');
    const alias = await this.newAlias(offer.id);
    return this.linkCodeRow(alias);
  }

  private linkCodeRow(alias: OfferCodeAlias) {
    return {
      id: alias.id,
      code: alias.code,
      pixCreditPlanId: alias.offerId,
      isActive: alias.isActive,
      createdAt: alias.createdAt,
      updatedAt: alias.createdAt,
    };
  }

  private async activeAlias(code: string) {
    const alias = await this.prisma.offerCodeAlias.findFirst({
      where: { code: code.trim(), kind: 'PX', isActive: true },
      include: { offer: true },
    });
    return alias && metaOf(alias.offer)?.kind === 'PLAN' ? alias : null;
  }

  /** GET payments/pix-plan/link-code/:code */
  async getLinkCode(code: string) {
    const alias = await this.activeAlias(code);
    if (!alias)
      throw new NotFoundException(
        'Link-code PIX-PLAN não encontrado ou inativo',
      );
    return this.linkCodeRow(alias);
  }

  /** GET payments/pix-plan/link-code-details/:code/checkout */
  async getLinkCodeDetails(code: string) {
    const alias = await this.activeAlias(code);
    if (!alias)
      throw new NotFoundException('Link code PIX-PLAN não encontrado');
    const row = toLegacyPlanRow(alias.offer);
    return {
      id: alias.id,
      code: alias.code,
      pixCreditPlanId: alias.offerId,
      createdAt: alias.createdAt,
      updatedAt: alias.createdAt,
      plan: {
        id: row.id,
        value: row.price,
        frequencyType: frequencyOfOffer(alias.offer),
        paymentMethods: ['pix'],
        userId: row.userId,
        description: (row.description ?? '').replace(
          /\s*\[CPF:[^\]]*\|PAGATG\]/g,
          '',
        ),
        externalReference: null,
        redirectUrl: row.redirectUrl,
        webhookUrl: row.webhookUrl,
        domPlanId: null,
        status: row.status,
        frequency: 1,
        retryDays: 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      token: null,
    };
  }

  /** GET payments/pix-plan (paginado) */
  async listPlans(params: {
    userId: string;
    role?: string;
    page: number;
    limit: number;
    status?: 'ACTIVE' | 'INACTIVE';
    search?: string;
    onlyMine?: boolean;
  }) {
    const page = Number.isFinite(params.page) ? Math.max(1, params.page) : 1;
    const limit = Number.isFinite(params.limit)
      ? Math.min(Math.max(1, params.limit), 100)
      : 10;
    const isAdmin = params.role === 'ADMIN' && !params.onlyMine;
    const search = params.search?.trim();
    const where: Prisma.OfferWhereInput = {
      metadata: { path: ['pixPlan', 'kind'], equals: 'PLAN' },
      ...(isAdmin ? {} : { ownerUserId: params.userId }),
      ...(params.status ? { isActive: params.status === 'ACTIVE' } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { cpf: true, name: true, email: true } },
          codeAliases: {
            where: { isActive: true, kind: 'PX' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: { select: { accesses: true } },
        },
      }),
      this.prisma.offer.count({ where }),
    ]);
    const coproducao = await coproductionInfo(
      this.prisma,
      'ofertas',
      params.userId,
      items.map((o) => ({ id: o.id, userId: o.ownerUserId })),
    );
    return {
      items: items.map((o) => {
        const cpfRaw = o.owner?.cpf;
        const digits = cpfRaw?.replace(/\D/g, '') ?? '';
        return {
          ...pick(toLegacyPlanRow(o), [
            'id',
            'userId',
            'type',
            'price',
            'description',
            'redirectUrl',
            'webhookUrl',
            'status',
            'createdAt',
            'updatedAt',
          ]),
          linkCode: o.codeAliases[0]?.code ?? null,
          subscriberCount: o._count.accesses,
          coproducao: coproducao.get(o.id) ?? null,
          cpfDono: cpfRaw
            ? digits.length === 11
              ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
              : cpfRaw
            : null,
          donoNome: o.owner?.name ?? null,
          donoEmail: o.owner?.email ?? null,
          tenantTag: displayTenantTag(o.platformTag),
        };
      }),
      meta: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** GET payments/pix-plan/:id */
  async getPlan(userId: string, id: string, role?: string) {
    const offer = await this.ownedPlan(userId, id, role);
    const alias = await this.prisma.offerCodeAlias.findFirst({
      where: { offerId: id, kind: 'PX', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    const row = toLegacyPlanRow(offer);
    return {
      data: {
        id: row.id,
        description: row.description ?? null,
        price: row.price,
        frequency_type: row.type,
        redirectUrl: row.redirectUrl ?? null,
        webhookUrl: row.webhookUrl ?? null,
        status: row.status,
        emailBody: row.emailBody ?? null,
        tenantTag: row.tenantTag ? row.tenantTag.toUpperCase() : null,
        linkCode: alias?.code ?? null,
        createdAt: row.createdAt,
      },
    };
  }

  /** PATCH payments/pix-plan/:id */
  async updatePlan(
    userId: string,
    id: string,
    body: {
      description?: string;
      price?: number;
      frequency_type?: PixFrequency;
      redirectUrl?: string | null;
      webhookUrl?: string | null;
      tenantTag?: string | null;
      emailBody?: string | null;
    },
    role?: string,
  ) {
    const offer = await this.ownedPlan(userId, id, role);
    if (body.description !== undefined && typeof body.description !== 'string')
      throw new BadRequestException('Descrição inválida');
    if (body.redirectUrl) {
      const unsafe = unsafeUrlReason(body.redirectUrl);
      if (unsafe) throw new BadRequestException(`redirectUrl: ${unsafe}`);
    }
    const selectedTag =
      body.tenantTag !== undefined
        ? assertExplicitPlatform(
            { id: userId, role },
            body.tenantTag ? [body.tenantTag] : undefined,
            true,
          )
        : undefined;
    const freq =
      body.frequency_type !== undefined
        ? FREQUENCY[body.frequency_type]
        : undefined;
    if (body.frequency_type !== undefined && !freq)
      throw new BadRequestException('Frequência inválida');
    if (body.price !== undefined && !(body.price > 0))
      throw new BadRequestException('Preço deve ser maior que zero');

    const fulfillment = readOfferFulfillment(offer.fulfillment);
    const meta = metaOf(offer) ?? { kind: 'PLAN' as const };
    const updated = await this.prisma.offer.update({
      where: { id },
      data: {
        ...(body.description !== undefined && {
          description: body.description,
          name: body.description.slice(0, 120) || offer.name,
        }),
        ...(body.price !== undefined && {
          amountCents: Math.round(body.price * 100),
        }),
        ...(freq && {
          intervalType: freq.intervalType,
          intervalCount: freq.intervalCount,
          accessDays: accessDaysForFrequency(freq.type),
        }),
        ...(body.tenantTag !== undefined && { platformTag: selectedTag }),
        ...((body.redirectUrl !== undefined ||
          body.emailBody !== undefined) && {
          fulfillment: {
            ...fulfillment,
            ...(body.redirectUrl !== undefined && {
              redirectUrl: body.redirectUrl || null,
            }),
            ...(body.emailBody !== undefined && {
              emailBody: body.emailBody || null,
            }),
          },
        }),
        ...(body.webhookUrl !== undefined && {
          metadata: {
            ...((offer.metadata ?? {}) as object),
            pixPlan: { ...meta, webhookUrl: body.webhookUrl || null },
          },
        }),
      },
    });
    return { data: { id: updated.id, tenantTag: updated.platformTag } };
  }

  /**
   * DELETE payments/pix-plan/:id e bot/pix-plan/:id. Oferta com cobrança, contrato ou acesso
   * não pode ser apagada (FK Restrict): fica desativada e escondida (`kind` DELETED).
   */
  async deletePlan(userId: string, id: string, role?: string) {
    const offer = await this.ownedPlan(userId, id, role);
    const [charges, contracts, accesses] = await Promise.all([
      this.prisma.charge.count({ where: { offerId: id } }),
      this.prisma.billingContract.count({ where: { offerId: id } }),
      this.prisma.offerAccess.count({ where: { offerId: id } }),
    ]);
    if (charges + contracts + accesses === 0) {
      await this.prisma.$transaction([
        this.prisma.offerCodeAlias.deleteMany({ where: { offerId: id } }),
        this.prisma.offer.delete({ where: { id } }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.offerCodeAlias.updateMany({
          where: { offerId: id },
          data: { isActive: false },
        }),
        this.prisma.offer.update({
          where: { id },
          data: {
            isActive: false,
            metadata: {
              ...((offer.metadata ?? {}) as object),
              pixPlan: { ...(metaOf(offer) ?? {}), kind: 'DELETED' },
            },
          },
        }),
      ]);
    }
    return { success: true, message: 'Plano PIX deletado com sucesso' };
  }

  /** PATCH bot/pix-plan/:id/status */
  async togglePlanStatus(userId: string, id: string, role?: string) {
    const plan = await this.prisma.offer.findUnique({ where: { id } });
    if (!plan || metaOf(plan)?.kind !== 'PLAN')
      throw new NotFoundException('Plano não encontrado');
    if (role !== 'ADMIN' && plan.ownerUserId !== userId)
      throw new BadRequestException(
        'Você não tem permissão para alterar este plano',
      );
    const active = !plan.isActive;
    await this.prisma.offer.update({
      where: { id },
      data: { isActive: active },
    });
    const accessResults = await this.access.applyOfferStatus(id, active);
    return {
      success: true,
      newStatus: active ? 'ACTIVE' : 'INACTIVE',
      affectedAccesses: accessResults.length,
      accessResults,
    };
  }

  // ── Checkout ────────────────────────────────────────────────────────────

  /** Oferta avulsa (sem plano cadastrado) do `pix-plan/checkout`, uma por vendedor/tipo/valor. */
  private async adhocOffer(
    userId: string,
    planType: LegacyPlanType,
    price: number,
  ): Promise<Offer> {
    const amountCents = Math.round(price * 100);
    const adhocKey = `${userId}:${planType}:${amountCents}`;
    const found = await this.prisma.offer.findFirst({
      where: {
        ownerUserId: userId,
        metadata: { path: ['pixPlan', 'adhocKey'], equals: adhocKey },
      },
    });
    if (found?.isActive) return found;
    if (found) throw new BadRequestException('Plano indisponível');
    return this.createOffer(ACTOR(userId), {
      name: `Plano PIX ${planType}`,
      amountCents,
      frequency: PLAN_TYPE_TO_FREQUENCY[planType] ?? 'MONTH',
      meta: { kind: 'ADHOC', adhocKey },
    });
  }

  private async pixFor(
    offer: Offer,
    customer: {
      name: string;
      email: string;
      document: string;
      document_type: string;
      mobile_phone: string;
      tracking?: Record<string, string>;
    },
  ) {
    const result = await this.subscriptions.subscribe(offer.code, {
      paymentMethod: 'pix',
      customerName: customer.name,
      customerEmail: customer.email,
      customerDocument: customer.document.replace(/[.-]/g, ''),
      customerPhone: customer.mobile_phone,
      documentType: customer.document_type as 'CPF' | 'CNPJ',
      tracking: customer.tracking,
    });
    // Comprador que já tem contrato e nada pendente: renovação por um novo PIX.
    if (result.existing && !result.pix) {
      const renewed = await this.renewals.renew(offer.code, {
        contractId: result.contractId,
        sig: signRenewal(result.contractId),
        paymentMethod: 'pix',
      });
      return {
        transactionId: renewed.transactionId,
        amount: renewed.amount,
        pix: renewed.pix,
      };
    }
    if (!result.transactionId || !result.pix)
      throw new BadRequestException(
        'Erro ao processar compra do plano via PIX',
      );
    return {
      transactionId: result.transactionId,
      amount: result.amount,
      pix: result.pix,
    };
  }

  private async paymentResponse(issued: {
    transactionId: string;
    amount: number;
    pix: {
      pixContent: string | null;
      qrCode: string | null;
      pixExpire: string | null;
    };
  }) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: issued.transactionId },
      select: { domPaymentId: true },
    });
    const id = tx?.domPaymentId ?? null;
    return {
      id,
      pixContent: issued.pix.pixContent,
      qrCode: issued.pix.qrCode,
      pixExpire: issued.pix.pixExpire,
      amount: issued.amount,
      paymentId: id,
      transactionId: issued.transactionId,
      status: 'PENDING',
    };
  }

  /** POST payments/pix-plan/checkout (autenticado) */
  async checkout(
    userId: string,
    body: {
      planType: LegacyPlanType;
      price: number;
      name: string;
      email: string;
      document: string;
      document_type: string;
      mobile_phone: string;
      tracking?: Record<string, string>;
    },
  ) {
    if (!body.document || !body.document_type)
      throw new BadRequestException(
        'Documento e tipo de documento são obrigatórios',
      );
    if (!body.price || body.price <= 0)
      throw new BadRequestException('Preço deve ser maior que zero');
    if (!body.email || !body.email.includes('@'))
      throw new BadRequestException('Email inválido');
    if (!body.name || body.name.trim().length < 2)
      throw new BadRequestException('Nome deve ter pelo menos 2 caracteres');
    const offer = await this.adhocOffer(userId, body.planType, body.price);
    return this.paymentResponse(await this.pixFor(offer, body));
  }

  /** POST payments/pix-plan/checkout-by-code (público) */
  async checkoutByCode(body: {
    code: string;
    name: string;
    email: string;
    document: string;
    document_type: string;
    mobile_phone: string;
    voucherCode?: string;
    finalAmount?: number;
    tracking?: Record<string, string>;
  }) {
    const alias = await this.activeAlias(body.code);
    if (!alias)
      throw new NotFoundException(
        'Link-code PIX-PLAN não encontrado ou inativo',
      );
    // Voucher/finalAmount: cupons de oferta ainda não existem (plano 0023, segunda leva);
    // o PIX sai pelo valor cheio da oferta.
    return this.paymentResponse(await this.pixFor(alias.offer, body));
  }

  // ── Acessos ─────────────────────────────────────────────────────────────

  /** GET payments/admin/pix-plan-access e GET public/pix-plan-access */
  async listAccess(params: CompatAccessListParams) {
    const { page, limit } = params;
    const where: Prisma.OfferAccessWhereInput = {};
    if (params.userId) {
      if (params.userId.includes('@')) {
        const user = await this.prisma.user.findUnique({
          where: { email: params.userId },
          select: { id: true },
        });
        if (!user)
          return {
            planAccess: [],
            meta: {
              currentPage: page,
              itemsPerPage: limit,
              totalItems: 0,
              totalPages: 0,
            },
          };
        where.ownerUserId = user.id;
      } else where.ownerUserId = params.userId;
    }
    if (params.isActive !== undefined) where.isActive = params.isActive;
    if (params.pixPlanId) where.offerId = params.pixPlanId;
    const s = params.search?.trim();
    if (s)
      where.OR = [
        { customerEmail: { contains: s, mode: 'insensitive' } },
        { customerDocument: { contains: s, mode: 'insensitive' } },
        { customerName: { contains: s, mode: 'insensitive' } },
      ];
    if (params.dateFrom || params.dateTo)
      where.createdAt = {
        ...(params.dateFrom && { gte: params.dateFrom }),
        ...(params.dateTo && {
          lte: new Date(params.dateTo.getTime() + 86399999),
        }),
      };
    const [items, total] = await Promise.all([
      this.prisma.offerAccess.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.offerAccess.count({ where }),
    ]);
    const now = new Date();
    const [sellers, customers, codes] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(items.map((a) => a.ownerUserId))] } },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.customer.findMany({
        where: {
          id: {
            in: items.flatMap((a) => (a.customerId ? [a.customerId] : [])),
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          document: true,
          documentType: true,
        },
      }),
      this.prisma.offerCodeAlias.findMany({
        where: {
          offerId: { in: [...new Set(items.map((a) => a.offerId))] },
          kind: 'PX',
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const sellerById = new Map(sellers.map((u) => [u.id, u]));
    const customerById = new Map(customers.map((c) => [c.id, c]));
    const codeByOffer = new Map<string, string>();
    for (const c of codes)
      if (!codeByOffer.has(c.offerId)) codeByOffer.set(c.offerId, c.code);
    return {
      planAccess: items.map((a: OfferAccess) => {
        const customer = a.customerId
          ? (customerById.get(a.customerId) ?? null)
          : null;
        return {
          id: a.id,
          userId: a.ownerUserId,
          seller: sellerById.get(a.ownerUserId) ?? null,
          customer,
          customerName: customer?.name ?? a.customerName ?? null,
          customerEmail: a.customerEmail,
          customerDocument: a.customerDocument,
          isActive: isEffectivelyActive(a, now),
          expiresAt: a.expiresAt,
          remainingDays: remainingDaysOf(a.expiresAt, now),
          totalDaysCredited: a.totalDaysCredited,
          lastTransactionId: a.lastTransactionId,
          pixPlanCode: codeByOffer.get(a.offerId) ?? null,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        };
      }),
      meta: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** GET public/purchase/:transactionId */
  async purchaseDetails(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!transaction) throw new NotFoundException('Transação não encontrada');
    const charge = await this.prisma.charge.findUnique({
      where: { transactionId },
      include: { offer: true },
    });
    const base = {
      id: transaction.id,
      status: transaction.status,
      amount: Number(transaction.amount),
      createdAt: transaction.createdAt,
      description: transaction.description,
    };
    if (!charge?.offer?.accessDays)
      return { type: 'UNKNOWN', transaction: base, seller: transaction.user };

    const offer = charge.offer;
    const [access, alias] = await Promise.all([
      this.prisma.offerAccess.findFirst({
        where: { lastTransactionId: transaction.id },
      }),
      this.prisma.offerCodeAlias.findFirst({
        where: { offerId: offer.id, kind: 'PX', isActive: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const customer = access?.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: access.customerId },
        })
      : null;
    return {
      type: 'PIX_PLAN',
      transaction: base,
      seller: transaction.user,
      customer: {
        email: charge.customerEmail,
        document: charge.customerDocument,
        name: customer?.name ?? charge.customerName ?? null,
      },
      plan: {
        name: offer.description || offer.name,
        type: planTypeOfOffer(offer),
        daysCredited: offer.accessDays,
        price: offer.amountCents / 100 || Number(transaction.amount),
        code: alias?.code ?? null,
      },
      planAccess: access
        ? {
            id: access.id,
            isActive: access.isActive,
            expiresAt: access.expiresAt,
            remainingDays: remainingDaysOf(access.expiresAt, new Date()),
            totalDaysCredited: access.totalDaysCredited,
          }
        : null,
    };
  }
}

function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}
