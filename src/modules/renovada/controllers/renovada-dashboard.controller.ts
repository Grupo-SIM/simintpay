import { Controller, Get, Query, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PlatformDashboardService } from '../services/renovada-dashboard.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Admin Platforms')
@Controller('admin/plataformas')
export class PlatformDashboardController {
  constructor(
    private readonly dashboardService: PlatformDashboardService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':tag/dashboard')
  @ApiOperation({ summary: 'Obter dados da dashboard de uma plataforma específica' })
  async getStats(
    @Param('tag') tag: string,
    @Query('period') period?: string,
    @Query('dataInicio') dataInicio?: string,
    @Query('dataFim') dataFim?: string
  ) {
    return this.dashboardService.getDashboardData(tag, period, dataInicio, dataFim);
  }

  @Get(':tag/seller-stats')
  @ApiOperation({ summary: 'Sellers ativos e total de contas por plataforma' })
  async getSellerStats(@Param('tag') tag: string) {
    const upperTag = String(tag).toUpperCase();
    const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    const headers = { 'x-internal-token': token };

    if (upperTag === 'EBOOK' || upperTag === 'EBOOKSIM') {
      const backEbookUrl = String(process.env.BACK_EBOOK_URL ?? '').replace(/\/+$/, '');
      if (!backEbookUrl) return { totalContas: 0, sellersAtivos: 0 };
      const res = await fetch(`${backEbookUrl}/internal/stats`, { headers });
      if (!res.ok) return { totalContas: 0, sellersAtivos: 0 };
      return res.json() as Promise<{ totalContas: number; sellersAtivos: number }>;
    }

    if (upperTag === 'PAGATG') {
      const apiPagatgUrl = String(process.env.API_PAGATG_URL ?? '').replace(/\/+$/, '');
      if (!apiPagatgUrl) return { totalContas: 0, sellersAtivos: 0 };
      const res = await fetch(`${apiPagatgUrl}/internal/stats`, { headers });
      if (!res.ok) return { totalContas: 0, sellersAtivos: 0 };
      return res.json() as Promise<{ totalContas: number; sellersAtivos: number }>;
    }

    if (upperTag === 'AREAFLIX') {
      const areaflixLinks = await this.prisma.subscriptionLink.findMany({
        where: { webhookUrl: { contains: 'areaflix', mode: 'insensitive' } },
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
      const bindings = await this.prisma.communityLinkBinding.findMany({
        where: { communityId: community.id, subscriptionLinkId: { not: null } },
        select: { subscriptionLinkId: true },
        distinct: ['subscriptionLinkId'],
      });
      const linkIds = bindings.map((b) => b.subscriptionLinkId!).filter(Boolean);
      if (linkIds.length === 0) return { totalContas: 0, sellersAtivos: 0 };

      const activeStatuses = ['active', 'completed', 'approved', 'paid', 'success', 'trial'];
      const [totalContas, sellersAtivos] = await Promise.all([
        this.prisma.subscriptionLinkOrder.count({ where: { subscriptionLinkId: { in: linkIds } } }),
        this.prisma.subscriptionLinkOrder.count({
          where: { subscriptionLinkId: { in: linkIds }, status: { in: activeStatuses } },
        }),
      ]);
      return { totalContas, sellersAtivos };
    }

    return { totalContas: 0, sellersAtivos: 0 };
  }

  @Get(':tag/sellers-ativos')
  @ApiOperation({ summary: 'Lista paginada de usuários/assinantes ativos com saldo da carteira' })
  async getActiveSellers(
    @Param('tag') tag: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const upperTag = tag.toUpperCase();
    const tagLower = tag.toLowerCase();
    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);
    const skip = (pageNum - 1) * size;

    const empty = { data: [], total: 0, page: pageNum, pageSize: size };

    // ── AREAFLIX ──────────────────────────────────────────────────────────────
    if (upperTag === 'AREAFLIX') {
      const links = await this.prisma.subscriptionLink.findMany({
        where: { webhookUrl: { contains: 'areaflix', mode: 'insensitive' } },
        select: { id: true },
      });
      const linkIds = links.map((l) => l.id);
      if (!linkIds.length) return empty;

      const activeOrders = await this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: { in: linkIds }, status: { in: ['paid', 'active', 'approved'] } },
        select: { customerEmail: true, customerName: true, customerDocument: true, createdAt: true },
        distinct: ['customerEmail'],
        orderBy: { createdAt: 'desc' },
      });

      const total = activeOrders.length;
      const paged = activeOrders.slice(skip, skip + size);
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

    // ── Community (slug-identified) ───────────────────────────────────────────
    const community = await this.prisma.community.findUnique({
      where: { slug: tagLower },
      select: { id: true },
    });
    if (community) {
      const bindings = await this.prisma.communityLinkBinding.findMany({
        where: { communityId: community.id, subscriptionLinkId: { not: null } },
        select: { subscriptionLinkId: true },
        distinct: ['subscriptionLinkId'],
      });
      const linkIds = bindings.map((b) => b.subscriptionLinkId!).filter(Boolean);
      if (!linkIds.length) return empty;

      const activeStatuses = ['active', 'completed', 'approved', 'paid', 'success', 'trial'];
      const activeOrders = await this.prisma.subscriptionLinkOrder.findMany({
        where: { subscriptionLinkId: { in: linkIds }, status: { in: activeStatuses } },
        select: { customerEmail: true, customerName: true, customerDocument: true, createdAt: true },
        distinct: ['customerEmail'],
        orderBy: { createdAt: 'desc' },
      });

      const total = activeOrders.length;
      const paged = activeOrders.slice(skip, skip + size);

      return {
        data: paged.map((o) => ({
          name: o.customerName,
          email: o.customerEmail,
          cpf: o.customerDocument,
          balance: 0,
          lockedBalance: 0,
          createdAt: o.createdAt,
        })),
        total,
        page: pageNum,
        pageSize: size,
      };
    }

    // ── External platforms (EBOOK, EBOOKSIM, PAGATG) ─────────────────────────
    // Active = completed transaction this month on the platform
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const activeTxRows = await this.prisma.transaction.findMany({
      where: {
        status: 'COMPLETED' as any,
        createdAt: { gte: startOfMonth },
        user: {
          externalPlatformUsers: {
            some: { platform: { equals: tagLower, mode: 'insensitive' }, isDeleted: false },
          },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const activeUserIds = activeTxRows.map((r) => r.userId!).filter(Boolean);
    if (!activeUserIds.length) return empty;

    const total = activeUserIds.length;
    const pagedIds = activeUserIds.slice(skip, skip + size);

    const extUsers = await this.prisma.externalPlatformUser.findMany({
      where: {
        userId: { in: pagedIds },
        platform: { equals: tagLower, mode: 'insensitive' },
        isDeleted: false,
      },
      include: {
        wallet: true,
        user: { select: { name: true, email: true, cpf: true, createdAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

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
