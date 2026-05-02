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

    if (upperTag === 'COMUNIDADE') {
      const bindings = await this.prisma.communityLinkBinding.findMany({
        where: {
          subscriptionLinkId: { not: null },
          community: { slug: { not: 'areaflix', mode: 'insensitive' } },
        },
        select: { subscriptionLinkId: true },
        distinct: ['subscriptionLinkId'],
      });
      const linkIds = bindings.map((b) => b.subscriptionLinkId!).filter(Boolean);
      if (linkIds.length === 0) return { totalContas: 0, sellersAtivos: 0 };

      const activeStatuses = ['active', 'completed', 'approved', 'paid', 'success', 'trial'];

      const [totalContas, sellersAtivos] = await Promise.all([
        this.prisma.subscriptionLinkOrder.count({
          where: { subscriptionLinkId: { in: linkIds } },
        }),
        this.prisma.subscriptionLinkOrder.count({
          where: {
            subscriptionLinkId: { in: linkIds },
            status: { in: activeStatuses },
          },
        }),
      ]);
      return { totalContas, sellersAtivos };
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

    return { totalContas: 0, sellersAtivos: 0 };
  }
}
