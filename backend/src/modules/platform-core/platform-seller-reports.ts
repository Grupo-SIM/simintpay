import type { PlatformContext } from './platform-context.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { PlatformReportingService } from '../../application/services/platform-reporting.service';
import { computeUserNetBalance } from '../../application/helpers/user-platform-net-balance.helper';
import { computeBosqueAvailableSinceLastWithdrawal } from '../../application/helpers/bosque-available.helper';
import { getPlatformIntegrationValue } from '../platform-integrations/platform-integrations.store';
const OWNER_BALANCE_TAGS = new Set(['RENOVADA', 'REVALIDA', 'PAGATG', 'FRENDZ', 'BOSQUE']);
export class PlatformSellerReports {
 constructor(private readonly prisma: PrismaService, private readonly platformReporting: PlatformReportingService, private readonly expectedContext?: PlatformContext) {}

 private async assertCurrent(tag: string) {
   const platform = await this.prisma.platform.findUnique({ where: { tag: tag === 'EBOOKSIM' ? 'EBOOK' : tag.toUpperCase() }, include: { owner: true } });
   if (!platform?.isActive || !platform.owner.isActive || platform.owner.isPurged || this.expectedContext && (platform.id !== this.expectedContext.id || platform.ownerUserId !== this.expectedContext.ownerUserId)) throw new ForbiddenException('Plataforma ou dono inativo/alterado');
 }

 async resolveOwnerUserId(upperTag: string, tagLower: string): Promise<string> {
    const platform = await this.prisma.platform.findFirst({
      where: { tag: { equals: upperTag, mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
    });
    return platform?.ownerUserId ?? '';
  }

 async getSellerStats(tag: string) {
    await this.assertCurrent(tag);
    const upperTag = String(tag).toUpperCase();
    const token = getPlatformIntegrationValue(upperTag, 'INTERNAL_TOKEN') ?? '';
    const headers = { 'x-internal-token': token };

    if (upperTag === 'EBOOK' || upperTag === 'EBOOKSIM') {
      const backEbookUrl = String(getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? '').replace(/\/+$/, '');
      if (!backEbookUrl) return { totalContas: 0, sellersAtivos: 0 };
      const res = await fetch(`${backEbookUrl}/internal/stats`, { headers });
      if (!res.ok) return { totalContas: 0, sellersAtivos: 0 };
      return res.json() as Promise<{ totalContas: number; sellersAtivos: number }>;
    }

    if (upperTag === 'PAGATG') {
      const apiPagatgUrl = String(getPlatformIntegrationValue('PAGATG', 'BACKEND_URL') ?? '').replace(/\/+$/, '');
      if (!apiPagatgUrl) return { totalContas: 0, sellersAtivos: 0 };
      const res = await fetch(`${apiPagatgUrl}/internal/stats`, { headers });
      if (!res.ok) return { totalContas: 0, sellersAtivos: 0 };
      return res.json() as Promise<{ totalContas: number; sellersAtivos: number }>;
    }

    if (upperTag === 'AREAFLIX') {
      const areaflixLinks = await this.prisma.subscriptionLink.findMany({
        where: { OR: [{ platformTag: 'AREAFLIX' }, { plataformas: { has: 'AREAFLIX' } }] },
        select: { id: true },
      });
      const linkIds = areaflixLinks.map((l) => l.id);
      if (linkIds.length === 0) return { totalContas: 0, sellersAtivos: 0 };

      const [clientesTotais, assinantesAtivos] = await Promise.all([
        this.prisma.subscriptionLinkOrder.findMany({
          where: {
            subscriptionLinkId: { in: linkIds },
            status: { notIn: ['pending', 'cancelled', 'expired', 'failed'] },
          },
          select: { customerEmail: true },
          distinct: ['customerEmail'],
        }),
        this.prisma.subscriptionLinkOrder.findMany({
          where: {
            subscriptionLinkId: { in: linkIds },
            status: { in: ['paid', 'active', 'approved'] },
          },
          select: { customerEmail: true },
          distinct: ['customerEmail'],
        }),
      ]);

      return { totalContas: clientesTotais.length, sellersAtivos: assinantesAtivos.length };
    }

    // Community-specific tag: find by slug
    const community = await this.prisma.community.findUnique({
      where: { slug: upperTag.toLowerCase() },
      select: { id: true },
    });
    if (community) {
      return this.platformReporting.getCommunityCustomerStats(
        upperTag,
        community.id,
      );
    }

    return { totalContas: 0, sellersAtivos: 0 };
  }

 async getActiveSellers(tag: string, page = '1', pageSize = '20', apenasAtivos = 'true', fonteSaldo?: string) {
    await this.assertCurrent(tag);
    const upperTag = tag.toUpperCase();
    const tagLower = tag.toLowerCase();
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    if (!Number.isSafeInteger(pageNum) || !Number.isSafeInteger(size)) throw new BadRequestException('Paginação inválida');
    const skip = (pageNum - 1) * size;
    const somenteAtivos = apenasAtivos !== 'false';

    const empty = { data: [], total: 0, page: pageNum, pageSize: size };

    /**
     * `fonteSaldo=carteiras` — usado só pela aba "Saldos por Plataforma".
     * Força as mesmas fontes de /admin/plataformas/saldos-resumo (ledger do dono ou
     * carteiras de ExternalPlatformUser), em vez dos fluxos de assinantes. Sem isso,
     * plataformas como a Áreaflix caem na listagem por subscriptionLinkOrder e o modal
     * vem vazio mesmo com o card mostrando contas. Os demais consumidores deste endpoint
     * (modais de "sellers ativos" do Relatório por Produto) não passam o parâmetro e
     * mantêm o comportamento original.
     */
    const usarCarteiras = fonteSaldo === 'carteiras';

    // ── AREAFLIX ──────────────────────────────────────────────────────────────
    if (upperTag === 'AREAFLIX' && !usarCarteiras) {
      const links = await this.prisma.subscriptionLink.findMany({
        where: { OR: [{ platformTag: 'AREAFLIX' }, { plataformas: { has: 'AREAFLIX' } }] },
        select: { id: true },
      });
      const linkIds = links.map((l) => l.id);
      if (!linkIds.length) return empty;

      const statusFilter = somenteAtivos
        ? { in: ['paid', 'active', 'approved'] }
        : { notIn: ['pending', 'cancelled', 'expired', 'failed'] };

      const allOrders = await this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: { in: linkIds }, status: statusFilter },
        select: { customerEmail: true, customerName: true, customerDocument: true, createdAt: true },
        distinct: ['customerEmail'],
        orderBy: { createdAt: 'desc' },
      });

      const total = allOrders.length;
      const paged = allOrders.slice(skip, skip + size);
      const emails = paged.map((o) => o.customerEmail);

      const extUsers = await this.prisma.externalPlatformUser.findMany({
        where: { platform: { equals: 'areaflix', mode: 'insensitive' }, user: { email: { in: emails } } },
        include: { wallet: true, user: { select: { email: true } } },
      });
      const walletMap = new Map(extUsers.map((u) => [u.user?.email ?? '', u.wallet]));

      return {
        data: paged.map((o) => ({
          name: o.customerName,
          email: o.customerEmail,
          cpf: o.customerDocument,
          balance: Number(walletMap.get(o.customerEmail)?.balance ?? 0),
          lockedBalance: Number(walletMap.get(o.customerEmail)?.lockedBalance ?? 0),
          createdAt: o.createdAt,
        })),
        total,
        page: pageNum,
        pageSize: size,
      };
    }

    // ── EBOOK / EBOOKSIM ──────────────────────────────────────────────────────
    // Pulado quando usarCarteiras: esse branch busca por CPF numa API externa e o
    // saldo ali diverge do card (que soma ExternalPlatformUser.wallet no nosso banco).
    // Cai no branch genérico "External platforms" mais abaixo, que usa a mesma fonte.
    if ((upperTag === 'EBOOK' || upperTag === 'EBOOKSIM') && !usarCarteiras) {
      const backEbookUrl = String(getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? '').replace(/\/+$/, '');
      if (!backEbookUrl) {
          return empty;
      }
      const token = getPlatformIntegrationValue(upperTag, 'INTERNAL_TOKEN') ?? '';
      const qs = new URLSearchParams({ page: String(pageNum), pageSize: String(size) });
      const fetchUrl = `${backEbookUrl}/internal/users/list?${qs}`;
      const res = await fetch(fetchUrl, { headers: { 'x-internal-token': token } });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
          return empty;
      }
      const rawJson = await res.json() as { data: any[]; total: number };
      const { data: ebookUsers, total } = rawJson;
      if (ebookUsers?.length) {
        }

      const cpfs = ebookUsers.map((u: any) => u.cpf).filter(Boolean) as string[];
      const epuRecords = cpfs.length > 0
        ? await this.prisma.externalPlatformUser.findMany({
            where: { cpf: { in: cpfs }, platform: { equals: 'ebook', mode: 'insensitive' }, isDeleted: false },
            include: { wallet: true },
          })
        : [];
      if (epuRecords.length === 0 && cpfs.length > 0) {
        // Check if any EPU records exist for this platform at all
        const epuCount = await this.prisma.externalPlatformUser.count({ where: { platform: { equals: 'ebook', mode: 'insensitive' } } });
        }

      const walletMap = new Map(epuRecords.map((e) => [e.cpf, e.wallet]));

      return {
        data: ebookUsers.map((u: any) => ({
          name: u.name ?? '',
          email: u.email ?? '',
          cpf: u.cpf ?? '',
          balance: Number(walletMap.get(u.cpf)?.balance ?? 0),
          lockedBalance: Number(walletMap.get(u.cpf)?.lockedBalance ?? 0),
          createdAt: u.createdAt,
        })),
        total,
        page: pageNum,
        pageSize: size,
      };
    }

    // ── Community (slug-identified) ───────────────────────────────────────────
    const community = await this.prisma.community.findUnique({
      where: { slug: tagLower },
      select: { id: true },
    });
    if (community) {
      if (!usarCarteiras) {
        return this.platformReporting.listCommunityCustomers(
          upperTag,
          community.id,
          { page: pageNum, pageSize: size, onlyActive: somenteAtivos },
        );
      }
      const bindings = await this.prisma.communityLinkBinding.findMany({
        where: { communityId: community.id, subscriptionLinkId: { not: null } },
        select: { subscriptionLinkId: true },
        distinct: ['subscriptionLinkId'],
      });
      const linkIds = bindings.map((b) => b.subscriptionLinkId!).filter(Boolean);
      if (!linkIds.length) return empty;

      // fonteSaldo=carteiras: comunidade não tem "saldo de carteira" por assinante —
      // o card soma o valor líquido (amountCharged − platformFeeAmount) de cada pedido
      // PAGO (mesma fonte de getComunidadeOrderRows, usada em /admin/plataformas/
      // saldos-resumo). Listamos os pedidos pagos com o valor de cada um, em vez de
      // "contas com saldo" — aqui balance = valor líquido do pedido, não carteira.
      if (usarCarteiras) {
        const paidOrders = await this.prisma.subscriptionLinkOrder.findMany({
          where: { subscriptionLinkId: { in: linkIds }, status: 'paid' },
          select: {
            customerEmail: true,
            customerName: true,
            customerDocument: true,
            createdAt: true,
            amountCharged: true,
            platformFeeAmount: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        const total = paidOrders.length;
        const paged = paidOrders.slice(skip, skip + size);

        return {
          data: paged.map((o) => ({
            name: o.customerName,
            email: o.customerEmail,
            cpf: o.customerDocument,
            balance: Number(o.amountCharged) - Number(o.platformFeeAmount),
            lockedBalance: 0,
            createdAt: o.createdAt,
          })),
          total,
          page: pageNum,
          pageSize: size,
        };
      }
    }

    // ── Atlas Hosting ─────────────────────────────────────────────────────────
    // Diferente de EbookSim/Áreaflix: a Atlas NÃO registra os clientes reais como
    // ExternalPlatformUser no nosso banco — só sincroniza ali um usuário sintético
    // ("Atlas Sistema") com o saldo agregado (ver AtlasDashboardController.syncExternalUser).
    // Os clientes de verdade só existem na API externa da própria Atlas, então este
    // branch sempre busca lá (com ou sem fonteSaldo=carteiras) — usar o branch genérico
    // aqui mostraria só o registro sintético, escondendo os clientes reais.
    if (upperTag === 'ATLAS') {
      const atlasUrl = String(getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? '').replace(/\/+$/, '');
      if (!atlasUrl) return empty;
      const token = getPlatformIntegrationValue(upperTag, 'INTERNAL_TOKEN') ?? '';
      const qs = new URLSearchParams({ page: String(pageNum), pageSize: String(size) });
      const res = await fetch(`${atlasUrl}/api/internal/users?${qs}`, { headers: { 'x-internal-token': token } });
      if (!res.ok) return empty;
      return res.json() as Promise<{ data: any[]; total: number; page: number; pageSize: number }>;
    }

    // ── Plataformas cujo saldo vive na conta do próprio dono ─────────────────
    // Renovada, Revalida, PagaTG, Frendz e Bosque não têm vendedores externos:
    // o saldo mostrado no card de "Saldos por Plataforma" vem do ledger do dono
    // (AVAILABLE_SOURCE 'owner'/'bosque' em /admin/plataformas/saldos-resumo).
    // Sem este bloco a busca cairia em ExternalPlatformUser e voltaria vazia,
    // com o card mostrando saldo e o modal dizendo "nenhuma conta".
    // Usa as mesmas fontes do resumo para os valores baterem exatamente.
    // Só na aba de saldos (fonteSaldo=carteiras) — os modais de "sellers ativos"
    // do Relatório por Produto seguem listando vendedores externos como antes.
    if (usarCarteiras && OWNER_BALANCE_TAGS.has(upperTag)) {
      const ownerId = await this.resolveOwnerUserId(upperTag, tagLower);
      if (!ownerId) return empty;

      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { name: true, email: true, cpf: true, createdAt: true },
      });
      if (!owner) return empty;

      const [wallet, productCount] = await Promise.all([
        this.prisma.wallet.findUnique({ where: { userId: ownerId } }),
        this.prisma.platform.count({ where: { ownerUserId: ownerId } }),
      ]);
      const sharedWallet = productCount > 1;
      const disponivel = sharedWallet
        ? Math.max(0, Number(wallet?.balance ?? 0) - Number(wallet?.lockedBalance ?? 0))
        : upperTag === 'BOSQUE'
          ? await computeBosqueAvailableSinceLastWithdrawal(this.prisma, [ownerId])
          : await computeUserNetBalance(this.prisma, ownerId, tagLower);

      return {
        data: [
          {
            walletScope: sharedWallet ? 'shared-owner' : 'owner',
            name: owner.name ?? upperTag,
            email: owner.email ?? '',
            cpf: owner.cpf ?? '',
            balance: Number(Math.max(0, disponivel).toFixed(2)),
            lockedBalance: Number(wallet?.lockedBalance ?? 0),
            createdAt: owner.createdAt,
          },
        ],
        total: 1,
        page: pageNum,
        pageSize: size,
      };
    }

    // ── External platforms (EBOOK, EBOOKSIM, PAGATG, etc.) ───────────────────
    // EBOOK and EBOOKSIM share the same platform key 'ebook' in ExternalPlatformUser
    const platformKey = (upperTag === 'EBOOK' || upperTag === 'EBOOKSIM') ? 'ebook' : tagLower;
    // Query ExternalPlatformUser directly — active = linked (userId set), all = any non-deleted
    const epuWhere = {
      platform: { equals: platformKey, mode: 'insensitive' as const },
      isDeleted: false,
      ...(somenteAtivos ? { userId: { not: null } } : {}),
    };

    const [total, extUsers] = await Promise.all([
      this.prisma.externalPlatformUser.count({ where: epuWhere }),
      this.prisma.externalPlatformUser.findMany({
        where: epuWhere,
        include: {
          wallet: true,
          user: { select: { name: true, email: true, cpf: true, createdAt: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size,
      }),
    ]);

    if (!total) return empty;

    return {
      data: extUsers.map((u) => ({
        name: u.user?.name ?? u.name,
        email: u.user?.email ?? '',
        cpf: u.user?.cpf ?? u.cpf,
        balance: Number(u.wallet?.balance ?? 0),
        lockedBalance: Number(u.wallet?.lockedBalance ?? 0),
        createdAt: u.user?.createdAt ?? u.createdAt,
      })),
      total,
      page: pageNum,
      pageSize: size,
    };
  }
}
