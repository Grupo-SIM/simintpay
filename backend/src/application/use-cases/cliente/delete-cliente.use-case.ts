import {
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class DeleteClienteUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    id: string;
  }): Promise<void> {
    const isAdmin = input.role === 'ADMIN' || input.role === 'MASTER';

    // 1. Verificar se o cliente existe
    const cliente = await this.prisma.customer.findUnique({
      where: { id: input.id },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente não encontrado');
    }

    // Se não for admin, o cliente deve pertencer ao usuário
    if (!isAdmin && cliente.userId !== input.userId) {
      throw new ForbiddenException(
        'Você não tem permissão para excluir este cliente',
      );
    }

    const domToken = await this.resolveDomToken(cliente.userId, false);
    if (!domToken) {
      throw new InternalServerErrorException(
        'Token DOM não configurado para o dono deste cliente',
      );
    }

    // 2. Buscar e cancelar assinaturas ativas (Cartão)
    const activeSubscriptions = await this.prisma.subscription.findMany({
      where: {
        customerId: cliente.id,
        status: { notIn: ['canceled', 'cancelled', 'inactive'] },
      },
    });

    for (const sub of activeSubscriptions) {
      if (sub.domSubscriptionId) {
        try {
          await this.gateway.cancelSubscription(
            domToken,
            sub.domSubscriptionId,
          );
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'canceled' },
          });
        } catch (error) {
          console.error(
            `[DeleteCliente] Erro ao cancelar assinatura ${sub.id}:`,
            error.message,
          );
        }
      }
    }

    // 3. Buscar e cancelar link orders ativas (Recorrência via Link)
    const activeLinkOrders = await this.prisma.subscriptionLinkOrder.findMany({
      where: {
        customerEmail: cliente.email,
        userId: cliente.userId,
        status: { notIn: ['canceled', 'cancelled', 'inactive'] },
      },
    });

    for (const sub of activeLinkOrders) {
      if (sub.domSubscriptionId) {
        try {
          await this.gateway.cancelSubscription(
            domToken,
            sub.domSubscriptionId,
          );
          await this.prisma.subscriptionLinkOrder.update({
            where: { id: sub.id },
            data: { status: 'canceled' },
          });
        } catch (error) {
          console.error(
            `[DeleteCliente] Erro ao cancelar link order ${sub.id}:`,
            error.message,
          );
        }
      }
    }

    // 4. Remover acessos de plano PIX (créditos)
    await this.prisma.customerPlanAccess.deleteMany({
      where: { customerId: cliente.id },
    });

    // 5. Excluir o cliente
    await this.prisma.customer.delete({
      where: { id: cliente.id },
    });
  }

  private async resolveDomToken(
    userId: string,
    isAdmin: boolean,
  ): Promise<string | null> {
    if (isAdmin) return process.env.DOM_TOKEN ?? null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true },
    });
    if (user?.domToken) return user.domToken;

    return process.env.DOM_TOKEN ?? null;
  }
}
