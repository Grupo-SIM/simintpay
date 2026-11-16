import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type BillingContract } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { OfferActor } from './offer.service';
import type { ListOfferSubscribersQueryDto } from './offer-subscribers.dto';
import {
  remainingDaysOf,
  resumedPeriod,
  SUBSCRIBER_STATUS_GROUPS,
} from './offer-subscription-pause';

/**
 * Assinantes de ofertas (contratos ligados a uma oferta) para o vendedor e o admin, com pausa e
 * retomada. O vendedor só enxerga contratos de ofertas que possui; admin vê tudo. Pausar guarda
 * os dias restantes e tira o contrato do ciclo (o cron só cobra ACTIVE/PAST_DUE); retomar conta
 * esses dias a partir de agora e devolve o contrato ao ciclo.
 */
@Injectable()
export class OfferSubscribersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(actor: OfferActor, query: ListOfferSubscribersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const and: Prisma.BillingContractWhereInput[] = [];
    if (query.statusGroup)
      and.push({ status: { in: SUBSCRIBER_STATUS_GROUPS[query.statusGroup] } });
    if (query.frequency)
      and.push({
        intervalType: query.frequency === 'YEARLY' ? 'YEAR' : 'MONTH',
        intervalCount: 1,
      });
    if (query.platform) and.push({ offer: { platformTag: query.platform } });
    const created: Prisma.DateTimeFilter = {};
    if (query.firstChargeFrom) created.gte = new Date(query.firstChargeFrom);
    if (query.firstChargeTo) created.lte = new Date(query.firstChargeTo);
    if (created.gte || created.lte) and.push({ createdAt: created });
    const search = query.search?.trim();
    if (search)
      and.push({
        OR: [
          { customerName: { contains: search, mode: 'insensitive' } },
          { customerEmail: { contains: search, mode: 'insensitive' } },
          { offer: { name: { contains: search, mode: 'insensitive' } } },
        ],
      });
    const where: Prisma.BillingContractWhereInput = {
      offerId: query.offerId ?? { not: null },
      ...(actor.role === 'ADMIN' ? {} : { offer: { ownerUserId: actor.id } }),
      AND: and,
    };
    const [total, rows] = await Promise.all([
      this.prisma.billingContract.count({ where }),
      this.prisma.billingContract.findMany({
        where,
        include: {
          offer: {
            select: { id: true, name: true, code: true, platformTag: true },
          },
          _count: { select: { charges: { where: { status: 'PAID' } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        status: row.status,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        offer: row.offer,
        amount: Number(row.unitAmount) * row.quantity,
        intervalType: row.intervalType,
        intervalCount: row.intervalCount,
        paidCycles: row._count.charges,
        createdAt: row.createdAt,
        currentPeriodEnd: row.currentPeriodEnd,
        nextChargeAt: row.nextChargeAt,
        pausedAt: row.pausedAt,
        remainingDays: row.pausedRemainingDays,
      })),
      page,
      pageSize,
      total,
      hasNextPage: total > page * pageSize,
    };
  }

  async pause(actor: OfferActor, contractId: string, now = new Date()) {
    const contract = await this.owned(actor, contractId);
    if (contract.status === 'PAUSED')
      throw new ConflictException(
        `Esta assinatura já está pausada com ${contract.pausedRemainingDays ?? 0} dias restantes.`,
      );
    if (contract.status !== 'ACTIVE')
      throw new BadRequestException(
        'Somente assinaturas ativas podem ser pausadas.',
      );
    const remainingDays = remainingDaysOf(contract.currentPeriodEnd, now);
    if (remainingDays <= 0)
      throw new BadRequestException(
        'Esta assinatura já está vencida; não é possível pausá-la.',
      );
    const open = await this.prisma.charge.count({
      where: { contractId, status: 'PENDING' },
    });
    if (open > 0)
      throw new ConflictException(
        'Há uma cobrança em aberto; aguarde o pagamento ou a expiração antes de pausar.',
      );
    const claimed = await this.prisma.billingContract.updateMany({
      where: { id: contractId, status: 'ACTIVE', version: contract.version },
      data: {
        status: 'PAUSED',
        pausedAt: now,
        pausedRemainingDays: remainingDays,
        nextChargeAt: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0)
      throw new ConflictException(
        'A assinatura mudou enquanto era pausada; tente novamente.',
      );
    return { remainingDays, pausedAt: now.toISOString() };
  }

  async resume(actor: OfferActor, contractId: string, now = new Date()) {
    const contract = await this.owned(actor, contractId);
    if (contract.status !== 'PAUSED')
      throw new NotFoundException(
        'Nenhuma pausa encontrada para esta assinatura.',
      );
    const remainingDays = contract.pausedRemainingDays ?? 0;
    if (remainingDays <= 0)
      throw new BadRequestException(
        'Os dias restantes desta pausa já foram consumidos.',
      );
    const period = resumedPeriod(contract, now);
    const claimed = await this.prisma.billingContract.updateMany({
      where: { id: contractId, status: 'PAUSED', version: contract.version },
      data: {
        status: 'ACTIVE',
        ...period,
        nextChargeAt: period.currentPeriodEnd,
        pausedAt: null,
        pausedRemainingDays: null,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0)
      throw new ConflictException(
        'A assinatura mudou enquanto era retomada; tente novamente.',
      );
    return {
      newExpiresAt: period.currentPeriodEnd.toISOString(),
      remainingDays,
    };
  }

  private async owned(
    actor: OfferActor,
    contractId: string,
  ): Promise<BillingContract> {
    const contract = await this.prisma.billingContract.findFirst({
      where: {
        id: contractId,
        offerId: { not: null },
        ...(actor.role === 'ADMIN' ? {} : { offer: { ownerUserId: actor.id } }),
      },
    });
    if (!contract) throw new NotFoundException('Assinatura não encontrada');
    return contract;
  }
}
