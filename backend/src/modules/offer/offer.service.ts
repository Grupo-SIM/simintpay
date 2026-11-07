import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Offer } from '@prisma/client';
import { assertClientCanCreate } from '../../application/helpers/client-rules.helper';
import {
  assertOwnershipPreserved,
  resolveFinancialOwner,
} from '../../application/helpers/financial-owner.helper';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../core/repositories/user.repository.interface';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { getModuleAcquirer } from '../module.registry';
import { generateOfferCode } from './offer-code';
import {
  buildOfferListOrder,
  buildOfferListWhere,
  offerListPaging,
} from './offer-list';
import {
  OfferFulfillmentError,
  parseOfferFulfillment,
  readOfferFulfillment,
  type OfferFulfillment,
} from './offer-fulfillment';
import type {
  CreateOfferDto,
  ListOffersQueryDto,
  UpdateOfferDto,
} from './offer.dto';
import { OFFER_PRESETS } from './offer.presets';
import {
  OfferValidationError,
  validateOfferInput,
  type NormalizedOffer,
  type OfferInput,
} from './offer.validator';

export type OfferActor = { id: string; role: string };

const CODE_ATTEMPTS = 5;

/** Campos seguros para o checkout público; nunca expõe titular, uso interno ou metadados administrativos. */
export type PublicBump = {
  code: string;
  role: 'BUMP' | 'UPSELL' | 'DOWNSELL';
  name: string;
  description: string | null;
  amountCents: number;
  currency: string;
};

export function toPublicOffer(offer: Offer, bumps: PublicBump[] = []) {
  const metadata = (offer.metadata ?? {}) as Record<string, unknown>;
  return {
    code: offer.code,
    kind: offer.kind,
    name: offer.name,
    description: offer.description,
    amountCents: offer.amountCents,
    currency: offer.currency,
    acceptedMethods: offer.acceptedMethods,
    maxInstallments: offer.maxInstallments,
    renewalMode: offer.renewalMode,
    intervalType: offer.intervalType,
    intervalCount: offer.intervalCount,
    repetitions: offer.repetitions,
    trialDays: offer.trialDays,
    accessDays: offer.accessDays,
    expiresAt: offer.expiresAt,
    requiresBuyerAddress: metadata.requiresBuyerAddress === true,
    bumps,
  };
}

@Injectable()
export class OfferService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async create(actor: OfferActor, dto: CreateOfferDto): Promise<Offer> {
    const { owner, platformTag, createdByUserId } = await resolveFinancialOwner(
      this.users,
      actor.id,
      {
        ownerUserId: dto.ownerUserId,
        platforms: dto.platformTag ? [dto.platformTag] : undefined,
      },
    );
    assertClientCanCreate(owner, (dto.amountCents ?? 0) / 100);

    // Preset do tipo; qualquer campo informado sobrescreve o padrão.
    const preset = OFFER_PRESETS[dto.kind];
    const renewalMode = dto.renewalMode ?? preset.renewalMode;
    const recurring = renewalMode !== 'NONE';
    const normalized = this.normalize({
      amountCents: dto.amountCents,
      acceptedMethods: dto.acceptedMethods ?? preset.acceptedMethods,
      maxInstallments: dto.maxInstallments ?? preset.maxInstallments,
      renewalMode,
      // O preset só preenche o intervalo quando o modo final é recorrente.
      intervalType:
        dto.intervalType ?? (recurring ? preset.intervalType : null),
      intervalCount:
        dto.intervalCount ?? (recurring ? preset.intervalCount : null),
      repetitions: dto.repetitions,
      trialDays: dto.trialDays,
      retryDays: dto.retryDays,
      graceDays: dto.graceDays,
      accessDays: dto.accessDays ?? preset.accessDays,
      metadata: dto.metadata,
      acquirer: getModuleAcquirer(platformTag),
    });

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      try {
        return await this.prisma.offer.create({
          data: {
            ...this.persistable(normalized),
            ownerUserId: owner.id,
            createdByUserId,
            platformTag,
            code: generateOfferCode(),
            kind: dto.kind,
            name: dto.name,
            description: dto.description ?? null,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            maxUses: dto.maxUses ?? null,
            fulfillment: await this.checkFulfillment(dto.fulfillment, owner.id),
          },
        });
      } catch (error) {
        const collision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        if (!collision || attempt === CODE_ATTEMPTS - 1) throw error;
      }
    }
    throw new Error('unreachable');
  }

  async update(
    actor: OfferActor,
    id: string,
    dto: UpdateOfferDto,
  ): Promise<Offer> {
    const existing = await this.owned(actor, id);
    // Titular, plataforma e código não mudam na edição.
    assertOwnershipPreserved(
      { userId: existing.ownerUserId, platformTag: existing.platformTag },
      dto as { ownerUserId?: string; platformTag?: string },
    );
    const renewalMode = dto.renewalMode ?? existing.renewalMode;
    const input: OfferInput = {
      amountCents: dto.amountCents ?? existing.amountCents,
      acceptedMethods: dto.acceptedMethods ?? existing.acceptedMethods,
      maxInstallments: dto.maxInstallments ?? existing.maxInstallments,
      renewalMode,
      // Voltar para NONE limpa a recorrência herdada em vez de rejeitá-la.
      intervalType:
        renewalMode === 'NONE'
          ? (dto.intervalType ?? null)
          : (dto.intervalType ?? existing.intervalType),
      intervalCount:
        renewalMode === 'NONE'
          ? (dto.intervalCount ?? null)
          : (dto.intervalCount ?? existing.intervalCount),
      repetitions:
        renewalMode === 'NONE'
          ? (dto.repetitions ?? null)
          : (dto.repetitions ?? existing.repetitions),
      // null limpa o campo; omitido mantém o valor atual.
      trialDays:
        dto.trialDays === undefined ? existing.trialDays : dto.trialDays,
      retryDays:
        dto.retryDays === undefined ? existing.retryDays : dto.retryDays,
      graceDays:
        dto.graceDays === undefined ? existing.graceDays : dto.graceDays,
      accessDays:
        dto.accessDays === undefined ? existing.accessDays : dto.accessDays,
      metadata:
        dto.metadata ?? (existing.metadata as Record<string, unknown> | null),
      acquirer: getModuleAcquirer(existing.platformTag),
    };
    if (dto.amountCents !== undefined) {
      const owner = await this.users.findById(existing.ownerUserId);
      assertClientCanCreate(owner, dto.amountCents / 100);
    }
    const normalized = this.normalize(input);
    return this.prisma.offer.update({
      where: { id },
      data: {
        ...this.persistable(normalized),
        name: dto.name,
        description: dto.description,
        isActive: dto.isActive,
        expiresAt:
          dto.expiresAt === null
            ? null
            : dto.expiresAt
              ? new Date(dto.expiresAt)
              : undefined,
        maxUses: dto.maxUses,
        fulfillment: await this.checkFulfillment(
          dto.fulfillment,
          existing.ownerUserId,
          existing.id,
        ),
      },
    });
  }

  async list(actor: OfferActor, query: ListOffersQueryDto = {}) {
    const isAdmin = actor.role === 'ADMIN';
    if (!isAdmin && query.ownerUserId && query.ownerUserId !== actor.id)
      throw new ForbiddenException('Titular não autorizado');
    const where = buildOfferListWhere(
      { ownerUserId: isAdmin ? query.ownerUserId : actor.id },
      query,
      {
        usedCount: this.prisma.offer.fields.usedCount,
        maxUses: this.prisma.offer.fields.maxUses,
      },
    );
    const ownerSearch = isAdmin ? query.ownerSearch?.trim() : undefined;
    if (ownerSearch)
      where.owner = {
        OR: [
          { name: { contains: ownerSearch, mode: 'insensitive' } },
          { email: { contains: ownerSearch, mode: 'insensitive' } },
        ],
      };
    const include = isAdmin
      ? { owner: { select: { id: true, name: true, email: true } } }
      : undefined;
    const orderBy = buildOfferListOrder(query.sort);
    const paging = offerListPaging(query);
    // Sem page/pageSize a resposta segue sendo a lista completa (compatibilidade).
    if (!paging) return this.prisma.offer.findMany({ where, orderBy, include });
    const [data, total] = await Promise.all([
      this.prisma.offer.findMany({
        where,
        include,
        orderBy,
        skip: paging.skip,
        take: paging.pageSize,
      }),
      this.prisma.offer.count({ where }),
    ]);
    return {
      data,
      meta: {
        page: paging.page,
        pageSize: paging.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
      },
    };
  }

  async get(actor: OfferActor, id: string): Promise<Offer> {
    return this.owned(actor, id);
  }

  async deactivate(actor: OfferActor, id: string): Promise<Offer> {
    await this.owned(actor, id);
    return this.prisma.offer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async getPublicByCode(code: string, now = new Date()) {
    const offer = await this.prisma.offer.findUnique({ where: { code } });
    const unavailable =
      !offer ||
      !offer.isActive ||
      (offer.expiresAt && offer.expiresAt <= now) ||
      (offer.maxUses !== null && offer.usedCount >= offer.maxUses);
    if (unavailable) throw new NotFoundException('Oferta não encontrada');
    return toPublicOffer(offer, await this.publicBumps(offer, now));
  }

  /** Bumps/upsell/downsell vendáveis, só com dados seguros (sem entrega, titular ou id interno). */
  private async publicBumps(offer: Offer, now: Date): Promise<PublicBump[]> {
    const { bumps } = readOfferFulfillment(offer.fulfillment);
    if (bumps.length === 0) return [];
    const rows = await this.prisma.offer.findMany({
      where: {
        id: { in: bumps.map((b) => b.offerId) },
        ownerUserId: offer.ownerUserId,
        isActive: true,
        renewalMode: 'NONE',
      },
    });
    const byId = new Map(rows.map((o) => [o.id, o]));
    return bumps.flatMap((b) => {
      const o = byId.get(b.offerId);
      if (!o || (o.expiresAt && o.expiresAt <= now)) return [];
      return [
        {
          code: o.code,
          role: b.role,
          name: o.name,
          description: o.description,
          amountCents: o.amountCents,
          currency: o.currency,
        },
      ];
    });
  }

  /**
   * Valida o JSON de entrega e as ofertas referenciadas (mesmo titular, avulsas, existentes,
   * diferentes da própria). Devolve o JSON normalizado para persistir.
   */
  private async checkFulfillment(
    raw: Record<string, unknown> | undefined,
    ownerUserId: string,
    selfId?: string,
  ): Promise<Prisma.InputJsonValue | undefined> {
    if (raw === undefined) return undefined;
    let parsed: OfferFulfillment;
    try {
      parsed = parseOfferFulfillment(raw);
    } catch (error) {
      if (error instanceof OfferFulfillmentError)
        throw new BadRequestException(error.issues.join('. '));
      throw error;
    }
    if (parsed.bumps.length) {
      if (selfId && parsed.bumps.some((b) => b.offerId === selfId))
        throw new BadRequestException(
          'Uma oferta não pode ser bump de si mesma',
        );
      const found = await this.prisma.offer.findMany({
        where: {
          id: { in: parsed.bumps.map((b) => b.offerId) },
          ownerUserId,
          renewalMode: 'NONE',
        },
        select: { id: true },
      });
      if (found.length !== parsed.bumps.length)
        throw new BadRequestException(
          'Bump deve referenciar ofertas avulsas existentes do mesmo titular',
        );
    }
    return parsed as unknown as Prisma.InputJsonValue;
  }

  private normalize(input: OfferInput): NormalizedOffer {
    try {
      return validateOfferInput(input);
    } catch (error) {
      if (error instanceof OfferValidationError)
        throw new BadRequestException(error.issues.join('. '));
      throw error;
    }
  }

  private persistable(offer: NormalizedOffer) {
    return {
      ...offer,
      metadata: (offer.metadata ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    };
  }

  /** Cliente só enxerga e altera ofertas que possui; admin mantém o escopo global. */
  private async owned(actor: OfferActor, id: string): Promise<Offer> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || (actor.role !== 'ADMIN' && offer.ownerUserId !== actor.id))
      throw new NotFoundException('Oferta não encontrada');
    return offer;
  }
}
