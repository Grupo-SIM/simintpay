import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../../../modules/module.registry';
import { advanceSubscriptionPeriod } from '../../helpers/subscription-period.helper';

@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    const domToken = await this.resolveDomToken(input.userId, input.role === 'ADMIN');
    if (!domToken) {
      throw new InternalServerErrorException('Token DOM não configurado para este usuário');
    }

    const linkOrder = await this.prisma.subscriptionLinkOrder.findFirst({
      where: { domSubscriptionId: input.id },
      include: { subscriptionLink: { select: { frequencyType: true } } },
    });
    let periodEndsAt = linkOrder?.currentPeriodEndsAt ?? null;

    if (linkOrder && !periodEndsAt) {
      try {
        const raw = (await this.gateway.getSubscription(domToken, input.id)) as Record<
          string,
          unknown
        >;
        periodEndsAt = this.extractPeriodEnd(raw);
      } catch {
        periodEndsAt = null;
      }
      periodEndsAt ??= advanceSubscriptionPeriod(
        linkOrder.createdAt,
        linkOrder.subscriptionLink.frequencyType,
      );
    }

    await this.gateway.cancelSubscription(domToken, input.id);

    if (linkOrder) {
      await this.prisma.subscriptionLinkOrder.update({
        where: { id: linkOrder.id },
        data: { status: 'cancelled', cancelledAt: new Date(), currentPeriodEndsAt: periodEndsAt },
      });
    }
  }

  private async resolveDomToken(userId: string, isAdmin: boolean): Promise<string | null> {
    if (isAdmin) return process.env.DOM_TOKEN ?? null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true, platform: { select: { tag: true } } },
    });
    if (user?.domToken) return user.domToken;

    const moduleToken = getModuleDomToken(user?.platform?.tag);
    if (moduleToken) return moduleToken;

    return process.env.DOM_TOKEN ?? null;
  }

  private extractPeriodEnd(raw: Record<string, unknown>): Date | null {
    const data = this.asRecord(raw.data) ?? raw;
    const recurring = this.asRecord(data.auto_recurring);
    const candidate =
      recurring?.next_date_invoice ??
      recurring?.end_date_invoice ??
      recurring?.expires_at ??
      data.next_date_invoice ??
      data.end_date_invoice ??
      data.expires_at ??
      data.expiresAt;
    if (typeof candidate !== 'string') return null;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
