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

      // Resolve platform label for each subscription via SubscriptionLink.domPlanId
      const planIds = result.items
        .map((s: DomSubscriptionOutput) => s.planId)
        .filter((id): id is string => !!id);

      const linksByPlanId = await this.resolveSubscriptionLinks(planIds);

      const mapped = result.items.map((s: DomSubscriptionOutput) => {
        const link = s.planId ? linksByPlanId.get(s.planId) : undefined;
        return {
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
          plataforma: this.derivePlatformLabel(link, s),
        };
      });

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

  private async resolveSubscriptionLinks(planIds: string[]): Promise<Map<string, {
    platformTag: string | null;
    name: string;
    communityName: string | null;
  }>> {
    if (planIds.length === 0) return new Map();

    const links = await this.prisma.subscriptionLink.findMany({
      where: { domPlanId: { in: planIds } },
      select: {
        domPlanId: true,
        name: true,
        platformTag: true,
        communityBindings: {
          select: { community: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const map = new Map<string, { platformTag: string | null; name: string; communityName: string | null }>();
    for (const link of links) {
      if (!link.domPlanId) continue;
      map.set(link.domPlanId, {
        platformTag: link.platformTag ?? null,
        name: link.name,
        communityName: link.communityBindings?.[0]?.community?.name ?? null,
      });
    }
    return map;
  }

  private derivePlatformLabel(
    link: { platformTag: string | null; name: string; communityName: string | null } | undefined,
    sub: DomSubscriptionOutput,
  ): string {
    if (link) {
      const tag = (link.platformTag ?? '').toUpperCase();
      if (tag === 'COMUNIDADE') return link.communityName ?? link.name;
      if (tag === 'AREAFLIX') return 'Areaflix';
      if (tag === 'GLOBAL') return link.name || 'Plataforma';
      return link.name || '—';
    }

    // Sem link no DB — tenta extrair plataforma a partir da description da DOM
    // (sub.name é o nome do assinante, não serve aqui)
    return this.extractPlatformFromDescription(sub.description ?? '');
  }

  private extractPlatformFromDescription(desc: string): string {
    const d = desc.toLowerCase();

    if (d.includes('pagatg') || d.includes('paga tg')) return 'PagaTG';
    if (d.includes('areaflix') || d.includes('área flix') || d.includes('area flix')) return 'Areaflix';
    if (d.includes('ebook') || d.includes('e-book')) return 'Ebook';
    if (d.includes('renovada')) return 'Renovada';
    if (d.includes('bosque') || d.includes('ibb')) return 'Bosque';
    if (d.includes('marketing raiz') || d.includes('marketing-raiz')) return 'Marketing Raiz';
    if (d.includes('revalida') || d.includes('révali')) return 'Revalida';

    // Última opção: retorna a própria description (é mais informativo que "—")
    return desc.trim() || '—';
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
