import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import {
  buildClientTaxaTag,
  applyPatchToOverrides,
  writeOverrides,
  getPlatformTaxaEffective,
} from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

type TaxaBody = { taxaCartao?: number; taxaPix?: number; taxaAssinatura?: number };

/** Módulo master: gestão e auditoria dos clientes SimintPay (vendedores auto-cadastrados). */
@Controller('admin/clientes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminClientesController {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMaster(authUser?: JwtPayload): Promise<void> {
    const requester = authUser?.sub
      ? await this.prisma.user.findUnique({
          where: { id: authUser.sub },
          include: { tenantModule: true },
        })
      : null;
    if (!requester || !isMasterAdminUser(requester)) {
      throw new ForbiddenException('Somente o módulo master pode gerenciar clientes');
    }
  }

  private async applyTaxa(email: string, body: TaxaBody): Promise<void> {
    const tag = buildClientTaxaTag(email);
    const patch: Record<string, number | null> = {};
    if (body.taxaCartao != null) patch['MDR_CC_MASTER_1X'] = Number(body.taxaCartao);
    if (body.taxaPix != null) patch['MDR_PIX'] = Number(body.taxaPix);
    if (body.taxaAssinatura != null) patch['TAXA_ASSINATURA'] = Number(body.taxaAssinatura);
    if (Object.keys(patch).length === 0) return;
    const next = applyPatchToOverrides(tag, patch);
    await writeOverrides(next);
  }

  // ── Backfill: plataforma SIMINTPAY em links/planos de clientes ─────────────
  @Post('backfill-plataforma-simintpay')
  @ApiOperation({
    summary: 'Backfill: atribui plataforma SIMINTPAY aos links/planos de clientes sem plataforma',
    description:
      'Só exibição/agrupamento — NÃO altera taxa (a taxa continua por CLIENT:<email> → SIM INT PAY/GLOBAL). ' +
      'Padrão é dry-run (só conta, não grava). Para aplicar de fato, use dry=false.',
  })
  @ApiQuery({ name: 'dry', required: false, description: "'true' (padrão) só simula/conta; 'false' aplica de fato", example: 'true' })
  @ApiQuery({ name: 'includeSubscriptions', required: false, description: "'true' inclui links de assinatura (SubscriptionLink)", example: 'false' })
  async backfillPlataformaSimintpay(
    @CurrentUser() authUser: JwtPayload,
    @Query('dry') dry = 'true',
    @Query('includeSubscriptions') includeSubscriptions = 'false',
  ) {
    await this.assertMaster(authUser);

    const apply = String(dry).toLowerCase() === 'false';
    const withSubs = String(includeSubscriptions).toLowerCase() === 'true';
    const TAG = 'SIMINTPAY';

    // Donos que são clientes SimintPay (auto-cadastrados, qualquer status).
    const clients = await this.prisma.user.findMany({
      where: { clientStatus: { not: null } },
      select: { id: true },
    });
    const clientIds = clients.map((c) => c.id);
    if (clientIds.length === 0) {
      return { dryRun: !apply, clientes: 0, message: 'Nenhum cliente SimintPay encontrado.' };
    }

    // Alvo: link/plano de cliente SEM plataforma atribuída.
    const where = { userId: { in: clientIds }, plataformas: { isEmpty: true } };

    const [paymentLinks, plans, subscriptionLinks] = await Promise.all([
      this.prisma.paymentLink.count({ where }),
      this.prisma.plan.count({ where }),
      withSubs ? this.prisma.subscriptionLink.count({ where }) : Promise.resolve(0),
    ]);

    // Amostra (até 10) de links pra você conferir antes de aplicar.
    const amostraPaymentLinks = await this.prisma.paymentLink.findMany({
      where,
      select: { id: true, title: true, userId: true },
      take: 10,
    });

    if (!apply) {
      return {
        dryRun: true,
        clientes: clientIds.length,
        afetados: {
          paymentLinks,
          plans,
          subscriptionLinks: withSubs ? subscriptionLinks : 'ignorado (use includeSubscriptions=true)',
        },
        amostraPaymentLinks,
        comoAplicar: 'Rode de novo com dry=false para gravar.',
      };
    }

    const [linksRes, plansRes, subsRes] = await Promise.all([
      this.prisma.paymentLink.updateMany({ where, data: { plataformas: [TAG] } }),
      this.prisma.plan.updateMany({ where, data: { plataformas: [TAG] } }),
      withSubs
        ? this.prisma.subscriptionLink.updateMany({ where, data: { plataformas: [TAG] } })
        : Promise.resolve({ count: 0 }),
    ]);

    return {
      dryRun: false,
      tag: TAG,
      clientes: clientIds.length,
      atualizados: {
        paymentLinks: linksRes.count,
        plans: plansRes.count,
        subscriptionLinks: withSubs ? subsRes.count : 'ignorado (use includeSubscriptions=true)',
      },
    };
  }

  // ── Gestão / aprovação ────────────────────────────────────────────────────

  @Get()
  async list(@CurrentUser() authUser?: JwtPayload, @Query('status') status = 'all') {
    await this.assertMaster(authUser);
    const where: { clientStatus: any } = { clientStatus: { not: null } };
    if (status === 'pending') where.clientStatus = 'PENDING';
    else if (status === 'approved') where.clientStatus = 'APPROVED';
    else if (status === 'rejected') where.clientStatus = 'REJECTED';

    const clientes = await this.prisma.user.findMany({
      where,
      orderBy: [{ clientStatus: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        email: true,
        clientStatus: true,
        clientApprovedAt: true,
        isActive: true,
        createdAt: true,
      },
    });

    const data = clientes.map((c) => ({
      ...c,
      taxaCartao: getPlatformTaxaEffective(
        buildClientTaxaTag(c.email),
        'MDR_CC_MASTER_1X',
        PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X,
      ),
      taxaPix: getPlatformTaxaEffective(
        buildClientTaxaTag(c.email),
        'MDR_PIX',
        PLATFORM_TAXA_DEFAULTS.MDR_PIX,
      ),
      taxaAssinatura: getPlatformTaxaEffective(
        buildClientTaxaTag(c.email),
        'TAXA_ASSINATURA',
        PLATFORM_TAXA_DEFAULTS.TAXA_ASSINATURA,
      ),
    }));
    return { data };
  }

  @Patch(':id/aprovar')
  async aprovar(
    @Param('id') id: string,
    @Body() body: TaxaBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Cliente não encontrado');
    await this.prisma.user.update({
      where: { id },
      data: { clientStatus: 'APPROVED', clientApprovedAt: new Date() },
    });
    await this.applyTaxa(user.email, body);
    return { success: true };
  }

  @Patch(':id/rejeitar')
  async rejeitar(@Param('id') id: string, @CurrentUser() authUser?: JwtPayload) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Cliente não encontrado');
    await this.prisma.user.update({ where: { id }, data: { clientStatus: 'REJECTED' } });
    return { success: true };
  }

  @Patch(':id/taxa')
  async taxa(
    @Param('id') id: string,
    @Body() body: TaxaBody,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Cliente não encontrado');
    await this.applyTaxa(user.email, body);
    return { success: true };
  }

  // ── Auditoria: itens criados por clientes ──────────────────────────────────

  @Get('planos')
  async planos(@CurrentUser() authUser?: JwtPayload, @Query('clientId') clientId?: string) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.plan.findMany({
      where: { user: { clientStatus: { not: null } }, ...(clientId ? { userId: clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  @Get('planos-pix')
  async planosPix(@CurrentUser() authUser?: JwtPayload, @Query('clientId') clientId?: string) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.pixCreditPlan.findMany({
      where: { user: { clientStatus: { not: null } }, ...(clientId ? { userId: clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  @Get('links-pagamento')
  async linksPagamento(@CurrentUser() authUser?: JwtPayload, @Query('clientId') clientId?: string) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.paymentLink.findMany({
      where: { user: { clientStatus: { not: null } }, ...(clientId ? { userId: clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  @Get('links-assinatura')
  async linksAssinatura(@CurrentUser() authUser?: JwtPayload, @Query('clientId') clientId?: string) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.subscriptionLink.findMany({
      where: { user: { clientStatus: { not: null } }, ...(clientId ? { userId: clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  private attach<T extends { user: { id: string; name: string; email: string } }>(row: T) {
    return {
      ...row,
      clientId: row.user.id,
      clientName: row.user.name,
      clientEmail: row.user.email,
    };
  }
}
