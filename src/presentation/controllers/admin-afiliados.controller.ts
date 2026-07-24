import {
  Body,
  Controller,
  ConflictException,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { randomBytes } from 'crypto';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';

type SetAffiliateBody = { isAffiliate?: boolean; commissionPercent?: number };
type SetReferredByBody = { referredByUserId: string | null };

function generateAffiliateCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

async function assertMaster(prisma: PrismaService, authUser?: JwtPayload): Promise<void> {
  // authUser normalmente é o JwtPayload (campo `sub`), mas aceitamos também um
  // usuário já resolvido (campo `id`) para não acoplar este helper à forma
  // exata do request.user.
  const requesterId = authUser?.sub ?? (authUser as unknown as { id?: string } | undefined)?.id;
  const requester = requesterId
    ? await prisma.user.findUnique({
        where: { id: requesterId },
        include: { tenantModule: true },
      })
    : null;
  if (!requester || !isMasterAdminUser(requester)) {
    throw new ForbiddenException('Somente o módulo master pode gerenciar afiliados');
  }
}

/** Módulo master: curadoria e configuração do programa de afiliados. */
@Controller('admin/afiliados')
@ApiTags('Afiliados (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminAfiliadosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar contas afiliadas' })
  async list(@CurrentUser() authUser?: JwtPayload) {
    await assertMaster(this.prisma, authUser);

    const affiliates = await this.prisma.user.findMany({
      where: { isAffiliate: true },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        affiliateCommissionPercent: true,
        affiliateCode: true,
        createdAt: true,
        _count: { select: { referrals: true } },
      },
    });

    const data = await Promise.all(
      affiliates.map(async (a) => {
        const totals = await this.prisma.affiliateCommission.aggregate({
          where: { affiliateUserId: a.id, status: 'CREDITED' },
          _sum: { commissionAmount: true },
        });
        return {
          id: a.id,
          name: a.name,
          email: a.email,
          commissionPercent: a.affiliateCommissionPercent,
          affiliateCode: a.affiliateCode,
          totalReferrals: a._count.referrals,
          totalCommission: Number(totals._sum.commissionAmount ?? 0),
          createdAt: a.createdAt,
        };
      }),
    );

    return { data };
  }

  @Get('buscar')
  @ApiOperation({ summary: 'Buscar usuários candidatos a afiliado (por nome/email)' })
  @ApiQuery({ name: 'q', required: true })
  async search(@Query('q') q: string, @CurrentUser() authUser?: JwtPayload) {
    await assertMaster(this.prisma, authUser);
    if (!q?.trim()) return { data: [] };

    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: q.trim(), mode: 'insensitive' } },
          { email: { contains: q.trim(), mode: 'insensitive' } },
        ],
      },
      take: 20,
      select: { id: true, name: true, email: true, isAffiliate: true },
    });

    return { data: users };
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Detalhe de um afiliado: código, indicados, total de comissão' })
  async detail(@Param('userId') userId: string, @CurrentUser() authUser?: JwtPayload) {
    await assertMaster(this.prisma, authUser);

    const affiliate = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        isAffiliate: true,
        affiliateCommissionPercent: true,
        affiliateCode: true,
        referrals: { select: { id: true, name: true, email: true, createdAt: true } },
      },
    });
    if (!affiliate) throw new NotFoundException('Usuário não encontrado');

    const totals = await this.prisma.affiliateCommission.aggregate({
      where: { affiliateUserId: userId, status: 'CREDITED' },
      _sum: { commissionAmount: true },
    });

    return {
      data: {
        ...affiliate,
        totalCommission: Number(totals._sum.commissionAmount ?? 0),
      },
    };
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Ativar/desativar afiliado e/ou definir a % de comissão' })
  async setAffiliate(
    @Param('userId') userId: string,
    @Body() body: SetAffiliateBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await assertMaster(this.prisma, authUser);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, affiliateCode: true },
    });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    const data: Record<string, unknown> = {};
    if (body.isAffiliate !== undefined) data.isAffiliate = body.isAffiliate;
    if (body.commissionPercent !== undefined) data.affiliateCommissionPercent = body.commissionPercent;
    if (body.isAffiliate === true && !target.affiliateCode) {
      data.affiliateCode = generateAffiliateCode();
    }

    await this.prisma.user.update({ where: { id: userId }, data });
    return { success: true };
  }

  @Patch('indicacao/:userId')
  @ApiOperation({ summary: 'Definir/trocar manualmente quem indicou esta conta' })
  async setReferredBy(
    @Param('userId') userId: string,
    @Body() body: SetReferredByBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await assertMaster(this.prisma, authUser);

    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (body.referredByUserId === userId) {
      throw new ConflictException('Uma conta não pode ser indicada por ela mesma');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByUserId: body.referredByUserId },
    });
    return { success: true };
  }
}
