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
export function toPublicOffer(offer: Offer) {
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
            fulfillment: dto.fulfillment as Prisma.InputJsonValue | undefined,
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
      trialDays: dto.trialDays ?? existing.trialDays,
      retryDays: dto.retryDays ?? existing.retryDays,
      graceDays: dto.graceDays ?? existing.graceDays,
      accessDays: dto.accessDays ?? existing.accessDays,
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
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        maxUses: dto.maxUses,
        fulfillment: dto.fulfillment as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async list(actor: OfferActor, query: ListOffersQueryDto = {}) {
    const isAdmin = actor.role === 'ADMIN';
    if (!isAdmin && query.ownerUserId && query.ownerUserId !== actor.id)
      throw new ForbiddenException('Titular não autorizado');
    return this.prisma.offer.findMany({
      where: {
        ownerUserId: isAdmin ? query.ownerUserId : actor.id,
        kind: query.kind,
      },
      orderBy: { createdAt: 'desc' },
    });
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
    return toPublicOffer(offer);
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
