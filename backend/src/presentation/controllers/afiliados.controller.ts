import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/** Painel do próprio afiliado — somente leitura, só enxerga os dados dele. */
@Controller('afiliados')
@ApiTags('Afiliados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class AfiliadosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({ summary: 'Meus dados de afiliado: código, indicados e extrato de comissão' })
  async me(@CurrentUser() authUser?: JwtPayload) {
    const userId = authUser?.sub ?? '';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isAffiliate: true,
        affiliateCode: true,
        referrals: { select: { id: true, name: true, email: true, createdAt: true } },
      },
    });

    if (!user || !user.isAffiliate) {
      return {
        data: {
          isAffiliate: false,
          affiliateCode: null,
          referrals: [],
          commissions: [],
          totalEarned: 0,
        },
      };
    }

    const [commissions, totals] = await Promise.all([
      this.prisma.affiliateCommission.findMany({
        where: { affiliateUserId: userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, transactionId: true, commissionAmount: true, status: true, createdAt: true },
      }),
      this.prisma.affiliateCommission.aggregate({
        where: { affiliateUserId: userId, status: 'CREDITED' },
        _sum: { commissionAmount: true },
      }),
    ]);

    return {
      data: {
        isAffiliate: true,
        affiliateCode: user.affiliateCode,
        referrals: user.referrals,
        commissions: commissions.map((c) => ({ ...c, commissionAmount: Number(c.commissionAmount) })),
        totalEarned: Number(totals._sum.commissionAmount ?? 0),
      },
    };
  }
}
