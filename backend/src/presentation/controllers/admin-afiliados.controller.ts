import {
  readSellerWalletAttribution,
  unavailableSellerWallet,
} from '../../modules/platform-core/seller-wallet-attribution';
import { canonicalTransactionPlatformTag } from '../../modules/platform-core/transaction-platform';
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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
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

async function assertMaster(
  prisma: PrismaService,
  authUser?: JwtPayload,
): Promise<void> {
  // authUser normalmente é o JwtPayload (campo `sub`), mas aceitamos também um
  // usuário já resolvido (campo `id`) para não acoplar este helper à forma
  // exata do request.user.
  const requesterId =
    authUser?.sub ?? (authUser as unknown as { id?: string } | undefined)?.id;
  const requester = requesterId
    ? await prisma.user.findUnique({
        where: { id: requesterId },
        include: { platform: true },
      })
    : null;
  if (!requester || !isMasterAdminUser(requester)) {
    throw new ForbiddenException(
      'Somente o módulo master pode gerenciar afiliados',
    );
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
      this.fetchExternalAffiliates(
        getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? undefined,
        '/internal/affiliates',
        'EBOOK',
      ),
      this.fetchExternalAffiliates(
        getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? undefined,
        '/api/internal/affiliates',
        'ATLAS',
      ),
    ]);

    return { data: [...data, ...ebook, ...atlas] };
  }

  /** Afiliados que vivem no banco de outra plataforma (somente leitura; falha não derruba a lista). */
  private async fetchExternalAffiliates(
    baseUrl: string | undefined,
    path: string,
    platform: string,
  ) {
    const base = String(baseUrl ?? '').replace(/\/+$/, '');
    if (!base) return [];
    const token =
      process.env.API_MACHINE_INTERNAL_TOKEN ||
      process.env.INTERNAL_SERVICE_TOKEN ||
      '';
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { 'x-internal-token': token },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as {
        data?: Array<Record<string, unknown>>;
      };
      return (json.data ?? []).map((a) => ({ ...a, platform }));
    } catch {
      return [];
    }
  }

  @Get('buscar')
  @ApiOperation({
    summary: 'Buscar usuários candidatos a afiliado (por nome/email)',
  })
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
  @ApiOperation({
    summary:
      'Indicados de um afiliado (qualquer plataforma) com as carteiras Sim Int Pay',
  })
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
          id: true,
          name: true,
          email: true,
          cpf: true,
          referrals: {
            select: { id: true, name: true, email: true, cpf: true },
          },
        },
      });
      if (!row) throw new NotFoundException('Usuário não encontrado');
      affiliate = {
        id: row.id,
        name: row.name,
        email: row.email,
        cpf: row.cpf,
      };
      const commissions = await this.prisma.affiliateCommission.findMany({
        where: { affiliateUserId: userId, status: 'CREDITED' },
        select: {
          referredUserId: true,
          transactionId: true,
          commissionAmount: true,
        },
      });
      const byUser = new Map<string, number>();
      for (const c of commissions) {
        byUser.set(
          c.referredUserId,
          (byUser.get(c.referredUserId) ?? 0) + Number(c.commissionAmount),
        );
      }
      const referralIds = row.referrals.map((r) => r.id);
      const purchases = referralIds.length
        ? await this.prisma.transaction.findMany({
            where: { userId: { in: referralIds }, status: 'COMPLETED' },
            select: {
              id: true,
              userId: true,
              amount: true,
              description: true,
              paymentMethod: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
      const commissionByTransaction = new Map(
        commissions.map((c) => [c.transactionId, Number(c.commissionAmount)]),
      );
      people = row.referrals.map((r) => {
        const selected = purchases.filter((p) => p.userId === r.id);
        return {
          ...r,
          generated: byUser.get(r.id) ?? 0,
          grossTotal: selected.reduce((sum, p) => sum + Number(p.amount), 0),
          purchases: selected.map((p) => ({
            title: p.description ?? 'Compra',
            type: p.paymentMethod,
            grossAmount: Number(p.amount),
            commissionAmount: commissionByTransaction.get(p.id) ?? 0,
            createdAt: p.createdAt,
          })),
        };
      });
    } else {
      const [base, path] =
        platform === 'EBOOK'
          ? [
              getPlatformIntegrationValue('EBOOK', 'BACKEND_URL') ?? undefined,
              `/internal/affiliates/${encodeURIComponent(userId)}`,
            ]
          : [
              getPlatformIntegrationValue('ATLAS', 'BACKEND_URL') ?? undefined,
              `/api/internal/affiliates/${encodeURIComponent(userId)}`,
            ];
      const url = String(base ?? '').replace(/\/+$/, '');
      if (!url) throw new NotFoundException('Plataforma não configurada');
      const token =
        process.env.API_MACHINE_INTERNAL_TOKEN ||
        process.env.INTERNAL_SERVICE_TOKEN ||
        '';
      const res = await fetch(`${url}${path}`, {
        headers: { 'x-internal-token': token },
      }).catch(() => null);
      if (!res?.ok)
        throw new NotFoundException('Não foi possível consultar a plataforma');
      const json = (await res.json()) as {
        data?: { affiliate: Person | null; referrals: Person[] };
      };
      affiliate = json.data?.affiliate ?? null;
      people = json.data?.referrals ?? [];
    }

    const all = [...(affiliate ? [affiliate] : []), ...people];
    const external = platform !== 'SIMINTPAY';
    const tag = canonicalTransactionPlatformTag(platform) ?? platform;
    // Remote IDs and emails are not SimIntPay identities. A document can
    // resolve only through an existing, unambiguous persisted beneficiary link.
    const documentOf = (p: Person) => String(p.cpf ?? '').replace(/\D/g, '');
    const documents = [
      ...new Set(
        all
          .map(documentOf)
          .filter((doc) => doc.length === 11 || doc.length === 14),
      ),
    ];
    const links =
      external && documents.length
        ? await this.prisma.externalPlatformUser.findMany({
            where: {
              OR: [{ cpf: { in: documents } }, { cnpj: { in: documents } }],
            },
            select: { cpf: true, cnpj: true, userId: true, platform: true },
          })
        : [];
    const beneficiaryOf = (p: Person): string | null => {
      if (!external) return p.id;
      const document = documentOf(p);
      if (document.length !== 11 && document.length !== 14) return null;
      const candidates = links.filter(
        (link) =>
          canonicalTransactionPlatformTag(link.platform) === tag &&
          (link.cpf === document || link.cnpj === document),
      );
      const ids = [...new Set(candidates.map((link) => link.userId))];
      return ids.length === 1 ? ids[0] : null;
    };
    const ids = [
      ...new Set(all.map(beneficiaryOf).filter((id): id is string => !!id)),
    ];
    const accounts =
      !external && ids.length
        ? await this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              wallet: { select: { balance: true, lockedBalance: true } },
            },
          })
        : [];
    const attributed = external
      ? await readSellerWalletAttribution(this.prisma, ids, tag)
      : new Map();
    const walletOf = (p: Person) => {
      const id = beneficiaryOf(p);
      if (external)
        return (id && attributed.get(id)) || unavailableSellerWallet;
      const account = accounts.find((a) => a.id === id);
      if (!account?.wallet) return null;
      return {
        walletScope: 'USER_WALLET_AGGREGATE',
        balance: Number(account.wallet.balance),
        lockedBalance: Number(account.wallet.lockedBalance),
      };
    };

    return {
      data: {
        affiliate: affiliate && { ...affiliate, wallet: walletOf(affiliate) },
        referrals: people.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          generated: Number(p.generated ?? 0),
          grossTotal: Number(p.grossTotal ?? 0),
          purchases: p.purchases ?? [],
          wallet: walletOf(p),
        })),
      },
    };
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Detalhe de um afiliado: código, indicados, total de comissão',
  })
  async detail(
    @Param('userId') userId: string,
    @CurrentUser() authUser?: JwtPayload,
  ) {
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
        referrals: {
          select: { id: true, name: true, email: true, createdAt: true },
        },
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
  @ApiOperation({
    summary: 'Ativar/desativar afiliado e/ou definir a % de comissão',
  })
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
    if (body.commissionPercent !== undefined)
      data.affiliateCommissionPercent = body.commissionPercent;
    if (body.isAffiliate === true && !target.affiliateCode) {
      data.affiliateCode = generateAffiliateCode();
    }

    await this.prisma.user.update({ where: { id: userId }, data });
    return { success: true };
  }

  @Patch('indicacao/:userId')
  @ApiOperation({
    summary: 'Definir/trocar manualmente quem indicou esta conta',
  })
  async setReferredBy(
    @Param('userId') userId: string,
    @Body() body: SetReferredByBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await assertMaster(this.prisma, authUser);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    if (body.referredByUserId === userId) {
      throw new ConflictException(
        'Uma conta não pode ser indicada por ela mesma',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByUserId: body.referredByUserId },
    });
    return { success: true };
  }
}
