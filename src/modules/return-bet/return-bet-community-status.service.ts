import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { PlanType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

export type ReturnBetMembershipStatus =
  | 'ACTIVE'
  | 'CANCELLED'
  | 'PAYMENT_FAILED'
  | 'EXPIRED'
  | 'NOT_FOUND';

export interface CommunityStatusResult {
  isActive: boolean;
  expiresAt: string | null;
  membershipStatus: ReturnBetMembershipStatus;
  periodEndsAt: string | null;
  issueStartedAt: string | null;
}

const ACTIVE_STATUSES = new Set(['active', 'paid', 'approved', 'trial']);
const FAILED_STATUSES = new Set([
  'failed',
  'payment_failed',
  'not_authorized',
  'refused',
  'inactive',
]);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

@Injectable()
export class ReturnBetCommunityStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async checkOne(input: { cpf?: string; email?: string }): Promise<CommunityStatusResult> {
    const cpf = input.cpf?.replace(/\D/g, '') || undefined;
    const email = input.email?.trim().toLowerCase() || undefined;
    if (!cpf && !email) return this.emptyResult();

    const association = await this.prisma.platformIntegration.findFirst({
      where: { key: 'COMMUNITY_PLATFORM_TAG', platform: { tag: 'RETURN-BET', isActive: true, owner: { isActive: true, isPurged: false } } },
    });
    const community = association?.url ? await this.prisma.platform.findUnique({ where: { tag: association.url }, include: { owner: true } }) : null;
    if (!community?.isActive || !community.owner.isActive || community.owner.isPurged) {
      throw new UnprocessableEntityException({ code: 'PLATFORM_CAPABILITY_UNAVAILABLE', capability: 'community', message: 'Comunidade não associada ou inativa' });
    }
    const link = await this.prisma.subscriptionLink.findFirst({
      where: { platformTag: community.tag },
      select: { id: true, frequencyType: true },
    });
    if (!link) return this.emptyResult();

    const orders = await this.prisma.subscriptionLinkOrder.findMany({
      where: {
        subscriptionLinkId: link.id,
        ...(cpf ? { customerDocument: cpf } : { customerEmail: email }),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        createdAt: true,
        updatedAt: true,
        currentPeriodEndsAt: true,
        issueStartedAt: true,
        cancelledAt: true,
        domSubscriptionId: true,
      },
    });
    if (orders.length === 0) return this.emptyResult();

    const root = orders.find((order) => order.domSubscriptionId) ?? orders[0];
    const latestSuccessful = orders.find((order) => ACTIVE_STATUSES.has(order.status.toLowerCase()));
    const periodEndsAt =
      root.currentPeriodEndsAt ??
      (latestSuccessful
        ? this.advancePeriod(latestSuccessful.createdAt, link.frequencyType)
        : null);
    const normalized = root.status.toLowerCase();

    if (CANCELLED_STATUSES.has(normalized)) {
      return this.result('CANCELLED', periodEndsAt, root.cancelledAt ?? root.updatedAt);
    }
    if (FAILED_STATUSES.has(normalized)) {
      return this.result('PAYMENT_FAILED', periodEndsAt, root.issueStartedAt ?? root.updatedAt);
    }
    if (ACTIVE_STATUSES.has(normalized)) {
      if (periodEndsAt && periodEndsAt.getTime() <= Date.now()) {
        return this.result('EXPIRED', periodEndsAt, periodEndsAt);
      }
      return this.result('ACTIVE', periodEndsAt, null);
    }

    return this.result('EXPIRED', periodEndsAt, root.updatedAt);
  }

  private result(
    membershipStatus: ReturnBetMembershipStatus,
    periodEndsAt: Date | null,
    issueStartedAt: Date | null,
  ): CommunityStatusResult {
    const period = periodEndsAt?.toISOString() ?? null;
    return {
      isActive: membershipStatus === 'ACTIVE',
      expiresAt: period,
      membershipStatus,
      periodEndsAt: period,
      issueStartedAt: issueStartedAt?.toISOString() ?? null,
    };
  }

  private emptyResult(): CommunityStatusResult {
    return this.result('NOT_FOUND', null, null);
  }

  private advancePeriod(from: Date, frequency: PlanType): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'WEEKLY':
        next.setUTCDate(next.getUTCDate() + 7);
        break;
      case 'TRIMESTRAL':
        next.setUTCMonth(next.getUTCMonth() + 3);
        break;
      case 'SEMESTRAL':
        next.setUTCMonth(next.getUTCMonth() + 6);
        break;
      case 'ANUAL':
        next.setUTCFullYear(next.getUTCFullYear() + 1);
        break;
      case 'MONTHLY':
      default:
        next.setUTCMonth(next.getUTCMonth() + 1);
        break;
    }
    return next;
  }
}
