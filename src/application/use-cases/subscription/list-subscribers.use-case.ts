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
    hasNextPage: boolean;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;
    const isAdmin = input.role === 'ADMIN';

    const domToken = await this.resolveDomToken(input.userId, isAdmin);

    if (!domToken) {
      this.logger.warn(`[ListSubscribers] Sem domToken para userId=${input.userId} role=${input.role}`);
      return { data: [], page, pageSize, hasNextPage: false, total: 0 };
    }

    try {
      // Fetch one extra item to detect if a next page exists (DOM's total field is unreliable)
      const result = await this.gateway.listSubscriptions(domToken, {
        page,
        pageSize: pageSize + 1,
      });

      const hasNextPage = result.items.length > pageSize;
      const pageItems = result.items.slice(0, pageSize);

      // Resolve platform metadata for each subscription via its DOM plan ID.
      const planIds = pageItems
        .map((s: DomSubscriptionOutput) => s.planId)
        .filter((id): id is string => !!id);

      const sourcesByPlanId = await this.resolveSubscriptionSources(planIds);

      const domIds = pageItems.map((s: DomSubscriptionOutput) => s.id).filter((id): id is string => !!id);

      // Buscar pausadas para marcar na listagem (não altera fluxo normal)
      const pauseMap = await this.resolvePauses(domIds, input.userId, isAdmin);

      const mapped = pageItems.map((s: DomSubscriptionOutput) => {
        const source = s.planId ? sourcesByPlanId.get(s.planId) : undefined;
        const pause = s.id ? pauseMap.get(s.id) : undefined;
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
          plataforma: this.derivePlatformLabel(source, s),
          plataformas: source?.plataformas ?? [],
          // Campos de pausa — null quando não pausada (fluxo normal inalterado)
          isPaused: !!pause,
          remainingDays: pause?.remainingDays ?? null,
          pausedAt: pause?.pausedAt?.toISOString() ?? null,
        };
      });

      // Adicionar assinaturas pausadas que sumiram da DOM após cancelamento
      // Só na página 1 para não duplicar ao paginar
      const pausedRows = page === 1
        ? await this.buildPausedRows(domIds, input.userId, isAdmin)
        : [];

      const allData = [...mapped, ...pausedRows];

      return {
        data: allData,
        page,
        pageSize,
        hasNextPage,
        total: (result.total ?? (page - 1) * pageSize + mapped.length) + (page === 1 ? pausedRows.length : 0),
      };
    } catch (err: any) {
      this.logger.error(`[ListSubscribers] Erro ao buscar da DOM: ${err.message}`, err.stack);
      return { data: [], page, pageSize, hasNextPage: false, total: 0 };
    }
  }

  /** Retorna mapa domSubscriptionId → pausa para as IDs recebidas da DOM */
  private async resolvePauses(
    domIds: string[],
    userId: string,
    isAdmin: boolean,
  ): Promise<Map<string, { remainingDays: number; pausedAt: Date }>> {
    if (domIds.length === 0) return new Map();
    const where = isAdmin
      ? { domSubscriptionId: { in: domIds } }
      : { domSubscriptionId: { in: domIds }, userId };
    const pauses = await this.prisma.subscriptionPause.findMany({
      where,
      select: { domSubscriptionId: true, remainingDays: true, pausedAt: true },
    });
    return new Map(pauses.map((p) => [p.domSubscriptionId, p]));
  }

  /**
   * Constrói linhas para assinaturas pausadas que já sumiram da listagem da DOM.
   * Só é chamado na página 1 para não duplicar.
   */
  private async buildPausedRows(
    domIdsAlreadyInList: string[],
    userId: string,
    isAdmin: boolean,
  ): Promise<object[]> {
    const where = isAdmin
      ? { domSubscriptionId: { notIn: domIdsAlreadyInList } }
      : { domSubscriptionId: { notIn: domIdsAlreadyInList }, userId };
    const pauses = await this.prisma.subscriptionPause.findMany({ where });
    if (pauses.length === 0) return [];

    return pauses.map((p) => ({
      id: p.domSubscriptionId,
      status: 'paused',
      nome: p.subscriberName ?? null,
      descricao: p.description ?? null,
      valor: p.valueBrl ?? null,
      frequencia: p.frequency ?? null,
      intervalo: p.interval ?? 1,
      ciclo: 0,
      formaPagamento: 'credit_card',
      primeiraCobranca: p.firstCharge ?? null,
      proximaCobranca: null,
      planoId: p.planId ?? null,
      planNome: p.description ?? null,
      cliente: null,
      criadoEm: p.createdAt.toISOString(),
      plataforma: p.plataforma ?? '—',
      isPaused: true,
      remainingDays: p.remainingDays,
      pausedAt: p.pausedAt.toISOString(),
    }));
  }

  private async resolveSubscriptionSources(planIds: string[]): Promise<Map<string, {
    platformTag: string | null;
    name: string;
    communityName: string | null;
    plataformas: string[];
    isPlan: boolean;
  }>> {
    if (planIds.length === 0) return new Map();

    const [links, plans] = await Promise.all([
      this.prisma.subscriptionLink.findMany({
        where: { domPlanId: { in: planIds } },
        select: {
          domPlanId: true,
          name: true,
          platformTag: true,
          plataformas: true,
          communityBindings: {
            select: { community: { select: { name: true } } },
            take: 1,
          },
        },
      }),
      this.prisma.plan.findMany({
        where: { domPlanId: { in: planIds } },
        select: {
          domPlanId: true,
          name: true,
          plataformas: true,
          user: { select: { clientStatus: true } },
        },
      }),
    ]);

    const map = new Map<string, {
      platformTag: string | null;
      name: string;
      communityName: string | null;
      plataformas: string[];
      isPlan: boolean;
    }>();
    for (const link of links) {
      if (!link.domPlanId) continue;
      const plataformas = link.plataformas ?? [];
      map.set(link.domPlanId, {
        platformTag: link.platformTag ?? plataformas[0] ?? null,
        name: link.name,
        communityName: link.communityBindings?.[0]?.community?.name ?? null,
        plataformas,
        isPlan: false,
      });
    }
    for (const plan of plans) {
      if (!plan.domPlanId || map.has(plan.domPlanId)) continue;
      const plataformas = plan.user?.clientStatus != null ? ['SIMINTPAY'] : (plan.plataformas ?? []);
      map.set(plan.domPlanId, {
        platformTag: plataformas[0] ?? null,
        name: plan.name,
        communityName: null,
        plataformas,
        isPlan: true,
      });
    }
    return map;
  }

  private derivePlatformLabel(
    source: {
      platformTag: string | null;
      name: string;
      communityName: string | null;
      plataformas: string[];
      isPlan: boolean;
    } | undefined,
    sub: DomSubscriptionOutput,
  ): string {
    if (source) {
      const tag = (source.platformTag ?? '').toUpperCase();
      if (tag === 'COMUNIDADE') return source.communityName ?? source.name;
      if (tag === 'AREAFLIX') return 'Areaflix';
      if (tag === 'GLOBAL') return source.name || 'Plataforma';
      if (source.isPlan) return (source.platformTag ?? source.name) || '—';
      return source.name || '—';
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
