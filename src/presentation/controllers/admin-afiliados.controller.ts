import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
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
        include: { platform: true },
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
          platform: 'SIMINTPAY',
        };
      }),
    );

    const [ebook, atlas] = await Promise.all([
      this.fetchExternalAffiliates((getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? undefined), '/internal/affiliates', 'EBOOK'),
      this.fetchExternalAffiliates((getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? undefined), '/api/internal/affiliates', 'ATLAS'),
    ]);

    return { data: [...data, ...ebook, ...atlas] };
  }

  /** Afiliados que vivem no banco de outra plataforma (somente leitura; falha não derruba a lista). */
  private async fetchExternalAffiliates(baseUrl: string | undefined, path: string, platform: string) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    if (!base) return [];
    const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
    try {
      const res = await fetch(`${base}${path}`, { headers: { 'x-internal-token': token } });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
      return (json.data ?? []).map((a) => ({ ...a, platform }));
    } catch {
      return [];
    }
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
      select: {
        id: true,
        name: true,
        email: true,
        isAffiliate: true,
        referredByUserId: true,
        referredBy: { select: { id: true, name: true, email: true } },
      },
    });

    return { data: users };
  }

  @Get(':userId/indicados')
  @ApiOperation({ summary: 'Indicados de um afiliado (qualquer plataforma) com as carteiras Sim Int Pay' })
  @ApiQuery({ name: 'platform', required: false })
  async referrals(
    @Param('userId') userId: string,
    @Query('platform') platform = 'SIMINTPAY',
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await assertMaster(this.prisma, authUser);

    type Purchase = {
      title: string;
      type?: string;
      grossAmount: number;
      commissionAmount: number;
      createdAt?: string | Date | null;
    };
    type Person = {
      id: string;
      name: string;
      email: string;
      cpf?: string | null;
      generated?: number;
      grossTotal?: number;
      purchases?: Purchase[];
    };
    let affiliate: Person | null = null;
    let people: Person[] = [];

    if (platform === 'SIMINTPAY') {
      const row = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, name: true, email: true, cpf: true,
          referrals: { select: { id: true, name: true, email: true, cpf: true } },
        },
      });
      if (!row) throw new NotFoundException('Usuário não encontrado');
      affiliate = { id: row.id, name: row.name, email: row.email, cpf: row.cpf };
      const commissions = await this.prisma.affiliateCommission.findMany({
        where: { affiliateUserId: userId, status: 'CREDITED' },
        select: { referredUserId: true, commissionAmount: true },
      });
      const byUser = new Map<string, number>();
      for (const c of commissions) {
        byUser.set(c.referredUserId, (byUser.get(c.referredUserId) ?? 0) + Number(c.commissionAmount));
      }
      people = row.referrals.map((r) => ({ ...r, generated: byUser.get(r.id) ?? 0 }));
    } else {
      const [base, path] =
        platform === 'EBOOK'
          ? [(getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? undefined), `/internal/affiliates/${encodeURIComponent(userId)}`]
          : [(getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? undefined), `/api/internal/affiliates/${encodeURIComponent(userId)}`];
      const url = String(base ?? '').replace(/\/+$/, '');
      if (!url) throw new NotFoundException('Plataforma não configurada');
      const token = process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN || '';
      const res = await fetch(`${url}${path}`, { headers: { 'x-internal-token': token } }).catch(() => null);
      if (!res?.ok) throw new NotFoundException('Não foi possível consultar a plataforma');
      const json = (await res.json()) as { data?: { affiliate: Person | null; referrals: Person[] } };
      affiliate = json.data?.affiliate ?? null;
      people = json.data?.referrals ?? [];
    }

    // Carteira Sim Int Pay: casa por e-mail ou CPF.
    const all = [...(affiliate ? [affiliate] : []), ...people];
    const emails = all.map((p) => p.email?.toLowerCase()).filter(Boolean) as string[];
    const cpfs = all.map((p) => p.cpf?.replace(/\D/g, '')).filter(Boolean) as string[];
    const accounts = await this.prisma.user.findMany({
      where: { OR: [{ email: { in: emails, mode: 'insensitive' } }, ...(cpfs.length ? [{ cpf: { in: cpfs } }] : [])] },
      select: { email: true, cpf: true, wallet: { select: { balance: true, lockedBalance: true } } },
    });
    const walletOf = (p: Person) => {
      const acc = accounts.find(
        (a) => a.email?.toLowerCase() === p.email?.toLowerCase() || (!!p.cpf && a.cpf === p.cpf.replace(/\D/g, '')),
      );
      if (!acc) return null;
      return {
        balance: Number(acc.wallet?.balance ?? 0),
        lockedBalance: Number(acc.wallet?.lockedBalance ?? 0),
      };
    };

    return {
      data: {
        affiliate: affiliate && { ...affiliate, wallet: walletOf(affiliate) },
        referrals: people.map((p) => ({
          id: p.id, name: p.name, email: p.email,
          generated: Number(p.generated ?? 0),
          grossTotal: Number(p.grossTotal ?? 0),
          purchases: p.purchases ?? [],
          wallet: walletOf(p),
        })),
      },
    };
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
