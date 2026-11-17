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

    const domToken = process.env.DOM_TOKEN ?? null;
    if (!domToken) {
      throw new InternalServerErrorException(
        'Token DOM não configurado para o dono deste cliente',
      );
    }

    // 2. Buscar e cancelar as assinaturas ativas das ofertas do vendedor para este cliente
    const contracts = await this.prisma.billingContract.findMany({
      where: {
        offer: { ownerUserId: cliente.userId },
        customerEmail: { equals: cliente.email, mode: 'insensitive' },
        status: { not: 'CANCELLED' },
      },
    });

    for (const contract of contracts) {
      try {
        if (contract.externalSubscriptionId)
          await this.gateway.cancelSubscription(
            domToken,
            contract.externalSubscriptionId,
          );
        await this.prisma.billingContract.update({
          where: { id: contract.id },
          data: {
            status: 'CANCELLED',
            accessEndsAt: contract.currentPeriodEnd,
          },
        });
      } catch (error) {
        console.error(
          `[DeleteCliente] Erro ao cancelar assinatura ${contract.id}:`,
          error.message,
        );
      }
    }

    // 3. Remover os acessos por crédito de dias (ofertas) do cliente
    await this.prisma.offerAccess.deleteMany({
      where: { ownerUserId: cliente.userId, customerId: cliente.id },
    });

    // 4. Linhas antigas de acesso de plano PIX seguram o cliente por FK até a tabela ser apagada
    await this.prisma.customerPlanAccess.deleteMany({
      where: { customerId: cliente.id },
    });

    // 5. Excluir o cliente
    await this.prisma.customer.delete({
      where: { id: cliente.id },
    });
  }
}
