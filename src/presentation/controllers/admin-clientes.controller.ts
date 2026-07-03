import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
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
