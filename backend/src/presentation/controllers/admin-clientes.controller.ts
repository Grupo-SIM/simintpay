import {
  Body,
  BadRequestException,
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
import { Prisma, Role } from '@prisma/client';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isMasterAdminUser } from '../../shared/utils/is-master-admin.util';
import {
  buildUserTaxaTag,
  getPlatformTaxaEffective,
  syncedAcquirerRate,
} from '../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../modules/platform-taxas/platform-taxas.keys';

type TaxaBody = {
  taxaCartao?: number;
  taxaPix?: number;
};

/**
 * O painel do PagaTG grava marcações internas de dono/tenant no nome/descrição
 * de planos (ex.: "teste 12345678901 pagatg", "[CPF:...|TAG]", "[NOME_DONO:...]")
 * e as remove ao exibir de volta na própria UI dele. A auditoria "Itens criados"
 * do SimintPay agrega produtos de várias plataformas e não fazia essa limpeza —
 * mesma regex usada em admin-pagatg/hooks/use-pix-plan-suffix.ts.
 */
function stripInternalOwnerTags(text: string | null | undefined): string {
  if (!text) return text ?? '';
  let clean = text.replace(/\s+\d{11}\s+pagatg$/i, '');
  clean = clean.replace(
    /\s*\[(?:CPF|CPF_DONO|NOME_DONO|TENANT)(?::|:\s*)[^\]]*\]/gi,
    '',
  );
  clean = clean.replace(/\s+pagatg$/i, '');
  return clean.trim();
}

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
          include: { platform: true },
        })
      : null;
    if (!requester || !isMasterAdminUser(requester)) {
      throw new ForbiddenException(
        'Somente o módulo master pode gerenciar clientes',
      );
    }
  }

  private async applyTaxa(userId: string, body: TaxaBody): Promise<void> {
    if (body.taxaCartao !== undefined || body.taxaPix !== undefined)
      throw new BadRequestException(
        'Taxas por cliente foram removidas; configure a plataforma em /admin/taxas',
      );
    void userId;
  }

  // ── Backfill: marca contas avulsas como cliente (clientStatus) ─────────────
  @Post('backfill-client-status')
  @ApiOperation({
    summary:
      'Backfill: marca contas avulsas (cliente direto) sem clientStatus como cliente APROVADO',
    description:
      'Sem clientStatus a conta NÃO é reconhecida como cliente: a taxa individual (CLIENT:<email>) ' +
      'que o master configura nunca é aplicada na cobrança. Alvo: role=USER, sem plataforma/módulo e ' +
      'SEM vínculo de vendedor de plataforma externa (marcar esses mudaria a taxa deles de plataforma → CLIENT). ' +
      'Padrão é dry-run (só conta). Use dry=false para aplicar. Opcional: email=<conta> para marcar só uma.',
  })
  @ApiQuery({
    name: 'dry',
    required: false,
    description: "'true' (padrão) só simula/conta; 'false' aplica",
    example: 'true',
  })
  @ApiQuery({
    name: 'email',
    required: false,
    description:
      'Marca apenas esta conta (ex.: tz@lucasebarbara.tzviagens.com.br)',
  })
  async backfillClientStatus(
    @CurrentUser() authUser: JwtPayload,
    @Query('dry') dry = 'true',
    @Query('email') email?: string,
  ) {
    await this.assertMaster(authUser);

    const apply = String(dry).toLowerCase() === 'false';
    const alvoEmail = email?.trim().toLowerCase();

    // Contas "master" de plataforma (Renovada, Bosque, …) têm role=USER e
    // platformId = null — o sync nunca atribui o módulo — então casariam no
    // filtro. Marcá-las como cliente mudaria a taxa delas (tag da plataforma →
    // CLIENT:<email>), marcaria os links como SIMINTPAY e aplicaria o mínimo de
    // cliente. NUNCA podem entrar no backfill.
    const PLATFORM_ACCOUNT_IDS = (
      await this.prisma.platform.findMany({ select: { ownerUserId: true } })
    ).map((platform) => platform.ownerUserId);

    const where: Prisma.UserWhereInput = {
      role: Role.USER,
      platformId: null,
      clientStatus: null,
      id: { notIn: PLATFORM_ACCOUNT_IDS },
      // Cliente de verdade tem documento. Conta sem cpf E sem cnpj é quase sempre
      // conta operadora de plataforma — fora do backfill por segurança.
      OR: [{ cpf: { not: null } }, { cnpj: { not: null } }],
      // Não marca vendedor de plataforma externa: virar "cliente" faria a cobrança
      // resolver a taxa por CLIENT:<email> em vez da tag da plataforma dele.
      externalPlatformUsers: { none: {} },
      ...(alvoEmail
        ? { email: { equals: alvoEmail, mode: 'insensitive' } }
        : {}),
    };

    const afetados = await this.prisma.user.count({ where });

    if (!apply) {
      const amostra = await this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          cpf: true,
          cnpj: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // Diagnóstico: quando foi pedido um e-mail específico e nada casou, explica
      // qual condição barrou — evita ficar no escuro com "afetados: 0".
      let diagnostico: unknown;
      if (alvoEmail && afetados === 0) {
        const u = await this.prisma.user.findFirst({
          where: { email: { equals: alvoEmail, mode: 'insensitive' } },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            cpf: true,
            cnpj: true,
            clientStatus: true,
            platformId: true,
            _count: { select: { externalPlatformUsers: true } },
          },
        });
        if (!u) {
          diagnostico = {
            encontrado: false,
            motivos: ['Nenhuma conta com esse e-mail.'],
          };
        } else {
          const motivos: string[] = [];
          if (u.role !== Role.USER)
            motivos.push(`role é ${u.role} (o alvo é USER)`);
          if (u.platformId)
            motivos.push(
              'conta pertence a uma plataforma/módulo (platformId preenchido)',
            );
          if (u.clientStatus !== null)
            motivos.push(
              `clientStatus já é ${u.clientStatus} — nada a fazer, já é cliente`,
            );
          if (u._count.externalPlatformUsers > 0) {
            motivos.push(
              'conta tem vínculo de vendedor de plataforma externa (excluída de propósito: marcar mudaria a taxa dela de plataforma para CLIENT)',
            );
          }
          diagnostico = { encontrado: true, conta: u, motivos };
        }
      }

      return {
        dryRun: true,
        afetados,
        amostra,
        ...(diagnostico ? { diagnostico } : {}),
        comoAplicar:
          'Rode de novo com dry=false para gravar (clientStatus=APPROVED).',
      };
    }

    const res = await this.prisma.user.updateMany({
      where,
      data: { clientStatus: 'APPROVED', clientApprovedAt: new Date() },
    });

    return { dryRun: false, atualizados: res.count, clientStatus: 'APPROVED' };
  }

  // ── Backfill: plataforma SIMINTPAY em links/planos de clientes ─────────────
  @Post('backfill-plataforma-simintpay')
  @ApiOperation({
    summary:
      'Backfill: atribui plataforma SIMINTPAY aos links/planos de clientes sem plataforma',
    description:
      'Só exibição/agrupamento — NÃO altera taxa (a taxa continua por CLIENT:<email> → SIM INT PAY/GLOBAL). ' +
      'Padrão é dry-run (só conta, não grava). Para aplicar de fato, use dry=false.',
  })
  @ApiQuery({
    name: 'dry',
    required: false,
    description: "'true' (padrão) só simula/conta; 'false' aplica de fato",
    example: 'true',
  })
  @ApiQuery({
    name: 'includeSubscriptions',
    required: false,
    description: "'true' inclui links de assinatura (SubscriptionLink)",
    example: 'false',
  })
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
      return {
        dryRun: !apply,
        clientes: 0,
        message: 'Nenhum cliente SimintPay encontrado.',
      };
    }

    // Alvo: link/plano de cliente SEM plataforma atribuída.
    const where = { userId: { in: clientIds }, plataformas: { isEmpty: true } };

    const [paymentLinks, plans, subscriptionLinks] = await Promise.all([
      this.prisma.paymentLink.count({ where }),
      this.prisma.plan.count({ where }),
      withSubs
        ? this.prisma.subscriptionLink.count({ where })
        : Promise.resolve(0),
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
          subscriptionLinks: withSubs
            ? subscriptionLinks
            : 'ignorado (use includeSubscriptions=true)',
        },
        amostraPaymentLinks,
        comoAplicar: 'Rode de novo com dry=false para gravar.',
      };
    }

    const [linksRes, plansRes, subsRes] = await Promise.all([
      this.prisma.paymentLink.updateMany({
        where,
        data: { plataformas: [TAG] },
      }),
      this.prisma.plan.updateMany({ where, data: { plataformas: [TAG] } }),
      withSubs
        ? this.prisma.subscriptionLink.updateMany({
            where,
            data: { plataformas: [TAG] },
          })
        : Promise.resolve({ count: 0 }),
    ]);

    return {
      dryRun: false,
      tag: TAG,
      clientes: clientIds.length,
      atualizados: {
        paymentLinks: linksRes.count,
        plans: plansRes.count,
        subscriptionLinks: withSubs
          ? subsRes.count
          : 'ignorado (use includeSubscriptions=true)',
      },
    };
  }

  // ── Gestão / aprovação ────────────────────────────────────────────────────

  @Get()
  async list(
    @CurrentUser() authUser?: JwtPayload,
    @Query('status') status = 'all',
  ) {
    await this.assertMaster(authUser);
    const where: { isCompany: boolean; clientStatus?: any } = {
      isCompany: true,
    };
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
        isCompany: true,
        createdAt: true,
      },
    });

    const data = clientes.map((c) => ({
      ...c,
      taxaCartao: getPlatformTaxaEffective(
        buildUserTaxaTag(c.id),
        'MDR_CC_MASTER_1X',
        PLATFORM_TAXA_DEFAULTS.MDR_CC_MASTER_1X,
      ),
      taxaPix: syncedAcquirerRate('PIX', 'ONLINE', 1),
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
    await this.applyTaxa(user.id, body);
    await this.prisma.user.update({
      where: { id },
      data: { clientStatus: 'APPROVED', clientApprovedAt: new Date() },
    });
    return { success: true };
  }

  @Patch(':id/rejeitar')
  async rejeitar(
    @Param('id') id: string,
    @CurrentUser() authUser?: JwtPayload,
  ) {
    await this.assertMaster(authUser);
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Cliente não encontrado');
    await this.prisma.user.update({
      where: { id },
      data: { clientStatus: 'REJECTED' },
    });
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
    await this.applyTaxa(user.id, body);
    return { success: true };
  }

  // ── Auditoria: itens criados por clientes ──────────────────────────────────

  @Get('planos')
  async planos(
    @CurrentUser() authUser?: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.plan.findMany({
      where: {
        user: { clientStatus: { not: null } },
        ...(clientId ? { userId: clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  @Get('planos-pix')
  async planosPix(
    @CurrentUser() authUser?: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.pixCreditPlan.findMany({
      where: {
        user: { clientStatus: { not: null } },
        ...(clientId ? { userId: clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    // PixCreditPlan não tem campo `name` — só `description`. A UI espera `name`.
    return {
      data: rows.map((r) => {
        const attached = this.attach(r);
        return { ...attached, name: attached.description || '—' };
      }),
    };
  }

  @Get('links-pagamento')
  async linksPagamento(
    @CurrentUser() authUser?: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.paymentLink.findMany({
      where: {
        user: { clientStatus: { not: null } },
        ...(clientId ? { userId: clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  @Get('links-assinatura')
  async linksAssinatura(
    @CurrentUser() authUser?: JwtPayload,
    @Query('clientId') clientId?: string,
  ) {
    await this.assertMaster(authUser);
    const rows = await this.prisma.subscriptionLink.findMany({
      where: {
        user: { clientStatus: { not: null } },
        ...(clientId ? { userId: clientId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return { data: rows.map((r) => this.attach(r)) };
  }

  private attach<
    T extends {
      user: { id: string; name: string; email: string };
      name?: string;
      description?: string | null;
    },
  >(row: T) {
    return {
      ...row,
      ...(row.name !== undefined
        ? { name: stripInternalOwnerTags(row.name) }
        : {}),
      ...(row.description !== undefined
        ? { description: stripInternalOwnerTags(row.description) }
        : {}),
      clientId: row.user.id,
      clientName: row.user.name,
      clientEmail: row.user.email,
    };
  }
}
