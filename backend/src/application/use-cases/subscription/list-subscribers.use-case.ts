import { subscriptionStatusGroup } from './subscription-status';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  IPaymentGateway,
  DomSubscriptionOutput,
} from '../../../core/services/payment-gateway.interface';
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
      this.logger.warn(
        `[ListSubscribers] Sem domToken para userId=${input.userId} role=${input.role}`,
      );
      return { data: [], page, pageSize, hasNextPage: false, total: 0 };
    }

    try {
      // A exclusão é local. Para não deixar páginas vazias, busca da DOM até
      // acumular os itens visíveis necessários para a página solicitada.
      const sourcePageSize = Math.max(pageSize + 1, 100);
      const historyExclusions =
        await this.prisma.subscriptionHistoryExclusion.findMany({
          select: { domSubscriptionId: true },
        });
      const excludedIds = new Set(
        historyExclusions.map((item) => item.domSubscriptionId),
      );
      let sourcePage = 1;
      let sourceHasNextPage = true;
      const visibleItems: DomSubscriptionOutput[] = [];

      while (sourceHasNextPage) {
        const result = await this.gateway.listSubscriptions(domToken, {
          page: sourcePage,
          pageSize: sourcePageSize,
        });
        const sourceItems = result.items;
        visibleItems.push(
          ...sourceItems.filter(
            (item) =>
              !excludedIds.has(item.id) || this.isActiveSubscription(item),
          ),
        );

        sourceHasNextPage = sourceItems.length === sourcePageSize;
        sourcePage += 1;
      }

      const visiblePageItems = visibleItems;

      // Resolve platform metadata for each subscription via its DOM plan ID.
      const planIds = visiblePageItems
        .map((s: DomSubscriptionOutput) => s.planId)
        .filter((id): id is string => !!id);

      const sourcesByPlanId = await this.resolveSubscriptionSources(planIds);

      const domIds = visiblePageItems
        .map((s: DomSubscriptionOutput) => s.id)
        .filter((id): id is string => !!id);

      // Buscar pausadas para marcar na listagem (não altera fluxo normal)
      const pauseMap = await this.resolvePauses(domIds, input.userId, isAdmin);

      const mapped = visiblePageItems.map((s: DomSubscriptionOutput) => {
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
      // Mesclar antes da paginação evita duplicação e mantém total correto.
      const pausedRows = await this.buildPausedRows(
        domIds,
        input.userId,
        isAdmin,
      );

      const normalize = (value: unknown) =>
        String(value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .trim();
      const query = input.query;
      const allData = [...mapped, ...pausedRows].filter((row) => {
        if (
          query.statusGroup &&
          subscriptionStatusGroup(row.status, row.isPaused) !==
            query.statusGroup
        )
          return false;
        if (query.status && normalize(row.status) !== normalize(query.status))
          return false;
        if (query.planoId && row.planoId !== query.planoId) return false;
        if (query.frequency) {
          const frequency = normalize(row.frequencia);
          const units =
            query.frequency === 'MONTHLY'
              ? ['month', 'monthly', 'mensal']
              : ['year', 'yearly', 'annual', 'anual'];
          if (!units.includes(frequency) || (row.intervalo ?? 1) !== 1)
            return false;
        }
        const platforms = 'plataformas' in row ? row.plataformas : [];
        if (
          query.platform &&
          ![row.plataforma, ...platforms].some(
            (value) => normalize(value) === normalize(query.platform),
          )
        )
          return false;
        if (
          query.search &&
          !normalize(
            [
              row.nome,
              row.descricao,
              row.cliente?.name,
              row.cliente?.email,
            ].join(' '),
          ).includes(normalize(query.search))
        )
          return false;
        if (query.firstChargeFrom || query.firstChargeTo) {
          const timestamp = row.primeiraCobranca
            ? new Date(row.primeiraCobranca).getTime()
            : NaN;
          if (!Number.isFinite(timestamp)) return false;
          if (
            query.firstChargeFrom &&
            timestamp < new Date(query.firstChargeFrom).getTime()
          )
            return false;
          if (
            query.firstChargeTo &&
            timestamp > new Date(query.firstChargeTo).getTime()
          )
            return false;
        }
        return true;
      });

      return {
        data: allData.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        hasNextPage: allData.length > page * pageSize,
        total: allData.length,
      };
    } catch (err: any) {
      this.logger.error(
        `[ListSubscribers] Erro ao buscar da DOM: ${err.message}`,
        err.stack,
      );
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
   * Mescla antes dos filtros e da paginação, sem duplicar IDs da DOM.
   */
  private async buildPausedRows(
    domIdsAlreadyInList: string[],
    userId: string,
    isAdmin: boolean,
  ) {
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

  private async resolveSubscriptionSources(planIds: string[]): Promise<
    Map<
      string,
      {
        platformTag: string | null;
        name: string;
        communityName: string | null;
        plataformas: string[];
        isPlan: boolean;
      }
    >
  > {
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

    const map = new Map<
      string,
      {
        platformTag: string | null;
        name: string;
        communityName: string | null;
        plataformas: string[];
        isPlan: boolean;
      }
    >();
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
      const plataformas =
        plan.user?.clientStatus != null
          ? ['SIMINTPAY']
          : (plan.plataformas ?? []);
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
    source:
      | {
          platformTag: string | null;
          name: string;
          communityName: string | null;
          plataformas: string[];
          isPlan: boolean;
        }
      | undefined,
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
    if (
      d.includes('areaflix') ||
      d.includes('área flix') ||
      d.includes('area flix')
    )
      return 'Areaflix';
    if (d.includes('ebook') || d.includes('e-book')) return 'Ebook';
    if (d.includes('renovada')) return 'Renovada';
    if (d.includes('bosque') || d.includes('ibb')) return 'Bosque';
    if (d.includes('marketing raiz') || d.includes('marketing-raiz'))
      return 'Marketing Raiz';
    if (d.includes('revalida') || d.includes('révali')) return 'Revalida';

    // Última opção: retorna a própria description (é mais informativo que "—")
    return desc.trim() || '—';
  }

  private isActiveSubscription(subscription: DomSubscriptionOutput): boolean {
    return subscriptionStatusGroup(subscription.status) === 'active';
  }

  private async resolveDomToken(
    userId: string,
    isAdmin: boolean,
  ): Promise<string | null> {
    if (isAdmin) {
      return process.env.DOM_TOKEN ?? null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { domToken: true },
    });

    if (user?.domToken) return user.domToken;

    return process.env.DOM_TOKEN ?? null;
  }
}
