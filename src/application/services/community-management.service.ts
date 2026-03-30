import { Injectable } from '@nestjs/common';
import { PaymentMethod, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

type ActivationInput = {
  communityId: string;
  userId: string;
  frequencyType: PlanType;
  paymentMethod: PaymentMethod;
  amountCharged?: number;
  subscriptionLinkOrderId?: string;
};

@Injectable()
export class CommunityManagementService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  }

  private inferCommunityName(name: string, description?: string | null): string {
    const text = `${description ?? ''} ${name}`.trim();
    const explicit = text.match(/\[COMUNIDADE:([^\]]+)\]/i)?.[1]?.trim();
    if (explicit) return explicit;
    return description?.trim() || name;
  }

  private frequencyDays(planType: PlanType): number {
    switch (planType) {
      case 'TRIMESTRAL': return 90;
      case 'SEMESTRAL': return 180;
      case 'ANUAL': return 365;
      default: return 30;
    }
  }

  async ensureAutomaticBindingForSubscriptionLink(input: {
    subscriptionLinkId: string;
    linkName: string;
    linkDescription?: string | null;
  }) {
    const communityName = this.inferCommunityName(input.linkName, input.linkDescription);
    const slug = this.slugify(communityName) || 'comunidade-sem-nome';

    const community = await this.prisma.community.upsert({
      where: { slug },
      update: {
        name: communityName,
        source: 'AUTOMATIC',
      },
      create: {
        slug,
        name: communityName,
        source: 'AUTOMATIC',
      },
    });

    const existing = await this.prisma.communityLinkBinding.findFirst({
      where: { subscriptionLinkId: input.subscriptionLinkId },
    });

    if (!existing) {
      await this.prisma.communityLinkBinding.create({
        data: {
          communityId: community.id,
          bindingType: 'SUBSCRIPTION_LINK',
          subscriptionLinkId: input.subscriptionLinkId,
          isManual: false,
        },
      });
    } else if (!existing.isManual && existing.communityId !== community.id) {
      await this.prisma.communityLinkBinding.update({
        where: { id: existing.id },
        data: { communityId: community.id },
      });
    }

    return community;
  }

  async bindSubscriptionLinkManually(input: { communityId: string; subscriptionLinkId: string }) {
    const existing = await this.prisma.communityLinkBinding.findFirst({
      where: { subscriptionLinkId: input.subscriptionLinkId },
    });
    if (existing) {
      return this.prisma.communityLinkBinding.update({
        where: { id: existing.id },
        data: {
          communityId: input.communityId,
          bindingType: 'SUBSCRIPTION_LINK',
          isManual: true,
        },
      });
    }
    return this.prisma.communityLinkBinding.create({
      data: {
        communityId: input.communityId,
        bindingType: 'SUBSCRIPTION_LINK',
        subscriptionLinkId: input.subscriptionLinkId,
        isManual: true,
      },
    });
  }

  async bindPaymentLinkManually(input: { communityId: string; paymentLinkId: string }) {
    const existing = await this.prisma.communityLinkBinding.findFirst({
      where: { paymentLinkId: input.paymentLinkId },
    });
    if (existing) {
      return this.prisma.communityLinkBinding.update({
        where: { id: existing.id },
        data: {
          communityId: input.communityId,
          bindingType: 'PAYMENT_LINK',
          isManual: true,
        },
      });
    }
    return this.prisma.communityLinkBinding.create({
      data: {
        communityId: input.communityId,
        bindingType: 'PAYMENT_LINK',
        paymentLinkId: input.paymentLinkId,
        isManual: true,
      },
    });
  }

  async unbind(bindingId: string) {
    await this.prisma.communityLinkBinding.delete({ where: { id: bindingId } });
  }

  async registerPendingPix(input: ActivationInput) {
    await this.prisma.communitySubscriptionEvent.create({
      data: {
        communityId: input.communityId,
        userId: input.userId,
        eventType: 'PIX_PENDING',
        paymentMethod: input.paymentMethod,
        amountCharged: input.amountCharged ? new Prisma.Decimal(input.amountCharged) : null,
        subscriptionLinkOrderId: input.subscriptionLinkOrderId,
      },
    });
  }

  async activateOrRenewCommunityAccess(input: ActivationInput) {
    const creditDays = this.frequencyDays(input.frequencyType);
    const now = new Date();
    const existing = await this.prisma.communityAccess.findUnique({
      where: {
        communityId_userId: {
          communityId: input.communityId,
          userId: input.userId,
        },
      },
    });

    if (!existing) {
      const expiresAt = new Date(now.getTime() + creditDays * 24 * 60 * 60 * 1000);
      await this.prisma.communityAccess.create({
        data: {
          communityId: input.communityId,
          userId: input.userId,
          status: 'ATIVA',
          isActive: true,
          startedAt: now,
          expiresAt,
          totalDaysCredited: creditDays,
        },
      });
      await this.prisma.communitySubscriptionEvent.create({
        data: {
          communityId: input.communityId,
          userId: input.userId,
          eventType: 'ACTIVATED',
          paymentMethod: input.paymentMethod,
          amountCharged: input.amountCharged ? new Prisma.Decimal(input.amountCharged) : null,
          subscriptionLinkOrderId: input.subscriptionLinkOrderId,
        },
      });
      return;
    }

    const baseDate = existing.expiresAt > now ? existing.expiresAt : now;
    const newExpiresAt = new Date(baseDate.getTime() + creditDays * 24 * 60 * 60 * 1000);

    await this.prisma.communityAccess.update({
      where: { id: existing.id },
      data: {
        status: 'ATIVA',
        isActive: true,
        statusReason: null,
        expiresAt: newExpiresAt,
        totalDaysCredited: existing.totalDaysCredited + creditDays,
      },
    });
    await this.prisma.communitySubscriptionEvent.create({
      data: {
        communityId: input.communityId,
        userId: input.userId,
        eventType: 'RENEWED',
        paymentMethod: input.paymentMethod,
        amountCharged: input.amountCharged ? new Prisma.Decimal(input.amountCharged) : null,
        subscriptionLinkOrderId: input.subscriptionLinkOrderId,
      },
    });
  }
}
