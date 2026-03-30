import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';
import { EmailService } from '../../../infrastructure/email/email.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class SendSubscriptionLinkAccessEmailUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
    private readonly email: EmailService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { orderId: string; customerEmail?: string }) {
    const order = await this.prisma.subscriptionLinkOrder.findUnique({
      where: { id: input.orderId },
      include: { subscriptionLink: true },
    });

    if (!order) throw new NotFoundException('Pedido não encontrado');

    const to = input.customerEmail?.trim() || order.customerEmail;
    if (!to) throw new BadRequestException('E-mail do destinatário não informado');

    const link = order.subscriptionLink;
    const redirectUrl = link.redirectUrl;

    await this.email.sendSubscriptionAccess({
      to,
      customerName: order.customerName,
      linkName: link.name,
      redirectUrl: redirectUrl ?? null,
      orderId: order.id,
    });

    return { sent: true };
  }
}
