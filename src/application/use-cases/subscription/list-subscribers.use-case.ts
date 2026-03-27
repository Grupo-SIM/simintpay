import { Inject, Injectable, Logger } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { getModuleDomToken } from '../../../modules/module.registry';
import type { IPaymentGateway, DomSubscriptionOutput } from '../../../core/services/payment-gateway.interface';
import type { ListSubscribersQueryDto } from '../../dtos/subscription/list-subscribers.query.dto';

@Injectable()
export class ListSubscribersUseCase {
  private readonly logger = new Logger(ListSubscribersUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role?: string;
    query: ListSubscribersQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;
    const isAdmin = input.role === 'ADMIN';

    const domToken = await this.resolveDomToken(input.userId, isAdmin);

    if (!domToken) {
      this.logger.warn(`[ListSubscribers] Sem domToken para userId=${input.userId} role=${input.role}`);
      return { data: [], page, pageSize, total: 0 };
    }

    try {
      const result = await this.gateway.listSubscriptions(domToken, {
        page,
        pageSize,
      });

      const mapped = result.items.map((s: DomSubscriptionOutput) => ({
        id: s.id,
        status: s.status ?? null,
        nome: s.name ?? null,
        descricao: s.description ?? null,
        valor: s.amount ?? null,
        frequencia: s.frequency ?? null,
        intervalo: s.interval ?? 1,
        ciclo: s.cycle ?? 0,
        formaPagamento: s.paymentMethod ?? 'credit_card',
        primeiraCobranca: s.firstBillingDate ?? s.createdAt ?? null,
        proximaCobranca: s.expiresAt ?? null,
        planoId: s.planId ?? null,
        planNome: s.description ?? null,
        cliente: s.customer ?? null,
        criadoEm: s.createdAt ?? null,
      }));

      return {
        data: mapped,
        page,
        pageSize,
        total: result.total ?? mapped.length,
      };
    } catch (err: any) {
      this.logger.error(`[ListSubscribers] Erro ao buscar da DOM: ${err.message}`, err.stack);
      return { data: [], page, pageSize, total: 0 };
    }
  }

  private async resolveDomToken(userId: string, isAdmin: boolean): Promise<string | null> {
    if (isAdmin) {
      return process.env.DOM_TOKEN ?? null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true, tenantModule: { select: { slug: true } } },
    });

    if (user?.domToken) return user.domToken;

    const moduleToken = getModuleDomToken(user?.tenantModule?.slug);
    if (moduleToken) return moduleToken;

    return process.env.DOM_TOKEN ?? null;
  }
}
