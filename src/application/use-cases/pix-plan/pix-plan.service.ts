import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PIX_PLAN_REPOSITORY } from '../../../core/repositories/pix-plan.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IPixPlanRepository } from '../../../core/repositories/pix-plan.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { PixPlanCheckoutDto } from '../../dtos/pix-plan/pix-plan-checkout.dto';
import type { PixPlanCheckoutByCodeDto } from '../../dtos/pix-plan/pix-plan-checkout-by-code.dto';
import type { CreatePixCreditPlanDto } from '../../dtos/pix-plan/create-pix-credit-plan.dto';
import { PagaTGConfig } from '../../../modules/pagatg/pagatg.config';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';
import { calculateSellerNetValue } from '../../helpers/transaction-fee.helper';

@Injectable()
export class PixPlanService {
  private readonly logger = new Logger(PixPlanService.name);

  constructor(
    @Inject(PIX_PLAN_REPOSITORY) private readonly repo: IPixPlanRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly prisma: PrismaService,
  ) { }

  private getDaysForPlan(planType: string): number {
    const daysMapping: Record<string, number> = {
      MONTHLY: 30,
      MONTH: 30,
      QUARTER: 90,
      TRIMESTRAL: 90,
      SEMESTER: 180,
      SEMESTRAL: 180,
      YEAR: 365,
      ANUAL: 365,
      ANNUAL: 365,
      DAILY: 1,
      WEEKLY: 7,
    };
    const normalizedType = planType.toUpperCase().trim();
    return daysMapping[normalizedType] ?? 30;
  }

  private mapFrequencyToType(
    freq?: 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR',
  ): 'MONTHLY' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' {
    switch (freq) {
      case 'MONTH':
        return 'MONTHLY';
      case 'QUARTER':
        return 'TRIMESTRAL';
      case 'SEMESTER':
        return 'SEMESTRAL';
      case 'YEAR':
        return 'ANUAL';
      default:
        return 'MONTHLY';
    }
  }

  private static readonly PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;

  /** CPF/CNPJ só com dígitos a partir do trecho [CPF:...|TAG] da descrição do plano */
  private extractOwnerDocumentDigitsFromPlanDescription(description: string | null | undefined): string | null {
    const m = (description ?? '').match(PixPlanService.PLAN_PLATFORM_CPF_REGEX);
    if (!m) return null;
    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 11) return null;
    return digits;
  }

  /** Conta Simpay com mesmo documento (CPF ou CNPJ no campo `cpf`) */
  private async findMerchantUserIdByDocumentDigits(digits: string): Promise<string | null> {
    const variants: string[] = [digits];
    if (digits.length === 11) {
      variants.push(digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    } else if (digits.length === 14) {
      variants.push(digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));
    }
    const user = await this.prisma.user.findFirst({
      where: { OR: variants.map((cpf) => ({ cpf })) },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Pagatg/integrações criam o plano com userId = usuário técnico (domToken).
   * Transações e saldo devem ir para o usuário Simpay cujo `cpf` bate com [CPF:...|TAG].
   */
  private async resolveTransactionUserIdForPixPlan(plan: {
    userId: string;
    description: string | null;
  }): Promise<string> {
    const owner = await this.prisma.user.findUnique({
      where: { id: plan.userId },
      select: { email: true },
    });
    const isPlatformShadow = (owner?.email ?? '').toLowerCase().endsWith('@auto.simpay.com');
    if (!isPlatformShadow) return plan.userId;

    const docDigits = this.extractOwnerDocumentDigitsFromPlanDescription(plan.description);
    if (!docDigits) return plan.userId;

    const merchantId = await this.findMerchantUserIdByDocumentDigits(docDigits);
    return merchantId ?? plan.userId;
  }

  private mapPixTypeToFrequency(
    pixType: string,
  ): 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR' {
    switch (pixType) {
      case 'ANUAL':
        return 'YEAR';
      case 'SEMESTRAL':
        return 'SEMESTER';
      case 'TRIMESTRAL':
        return 'QUARTER';
      case 'MONTHLY':
      default:
        return 'MONTH';
    }
  }

  // ── POST /payments/pix-plan/checkout ─────────────────────────────────────

  async createPixPlanPayment(userId: string, body: PixPlanCheckoutDto) {
    const domToken = process.env.DOM_TOKEN;
    if (!domToken) throw new UnauthorizedException('DOM_TOKEN não configurado');

    let effectiveUserId = userId;
    let planTenantTag: string | null = null;
    let planOwnerCpf: string | null = null;
    let planOwnerName: string | null = null;
    if (body.pixCreditPlanId) {
      const planRow = await this.repo.findPixCreditPlanById(body.pixCreditPlanId);
      if (planRow) {
        effectiveUserId = await this.resolveTransactionUserIdForPixPlan(planRow);
        if (planRow.tenantTag) {
          planTenantTag = planRow.tenantTag.toUpperCase();
        } else {
          const tagMatch = (planRow.description ?? '').match(/\|([A-Z0-9]+)\]/i);
          if (tagMatch) planTenantTag = tagMatch[1].toUpperCase();
        }
        planOwnerCpf = this.extractOwnerDocumentDigitsFromPlanDescription(planRow.description);
        // 1º: nome da tag [NOME_DONO:] gravada na descrição do plano (planos novos via api-pagatg)
        const nomeDonoMatch = (planRow.description ?? '').match(/\[NOME_DONO:([^\]]+)\]/i);
        planOwnerName = nomeDonoMatch ? nomeDonoMatch[1].trim() : null;
        // 2º fallback: nome da conta Simpay vinculada (quando o merchant já tem conta)
        if (!planOwnerName) {
          const ownerUser = await this.prisma.user.findUnique({
            where: { id: effectiveUserId },
            select: { name: true, email: true },
          });
          const isShadow = (ownerUser?.email ?? '').toLowerCase().endsWith('@auto.simpay.com');
          if (!isShadow) planOwnerName = ownerUser?.name?.trim() || null;
        }
      }
    }

    if (!body.document || !body.document_type)
      throw new BadRequestException('Documento e tipo de documento são obrigatórios');
    if (!body.price || body.price <= 0)
      throw new BadRequestException('Preço deve ser maior que zero');
    if (!body.email || !body.email.includes('@'))
      throw new BadRequestException('Email inválido');
    if (!body.name || body.name.trim().length < 2)
      throw new BadRequestException('Nome deve ter pelo menos 2 caracteres');

    let wallet = await this.prisma.wallet.findUnique({ where: { userId: effectiveUserId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId: effectiveUserId, balance: 0 },
      });
    }

    const amount = body.price;
    // Usa taxas configuradas para o tenant do plano; fallback para PAGATG se não identificado
    const tenantTag = planTenantTag ?? 'PAGATG';
    const mdrPix = getPlatformTaxaEffective(tenantTag, 'MDR_PIX', PLATFORM_TAXA_DEFAULTS.MDR_PIX);
    const netAmount = Number(calculateSellerNetValue(amount, 1, tenantTag, 'pix').toFixed(2));
    const totalFee = parseFloat((amount - netAmount).toFixed(2));
    const domFee = parseFloat((amount * mdrPix).toFixed(2));
    const platformFee = parseFloat((totalFee - domFee).toFixed(2));

    const transaction = await this.prisma.transaction.create({
      data: {
        userId: effectiveUserId,
        amount: new Prisma.Decimal(amount),
        netAmount: new Prisma.Decimal(netAmount),
        status: 'DRAFT',
        paymentMethod: 'PIX',
        totalFee: new Prisma.Decimal(totalFee),
        domFee: new Prisma.Decimal(domFee),
        platformFee: new Prisma.Decimal(platformFee),
        description: `${body.description ?? `PIX_PLAN:${body.planType}`}${planTenantTag ? ` [TENANT:${planTenantTag}]` : ''}${planOwnerCpf ? ` [CPF_DONO:${planOwnerCpf}]` : ''}${planOwnerName ? ` [NOME_DONO:${planOwnerName}]` : ''}`,
        customerName: body.name,
        customerEmail: body.email,
        customerDocument: body.document.replace(/[.-]/g, ''),
        customerPhone: body.mobile_phone,
      },
    });

    try {
      const payment = await this.gateway.createPixCheckout(domToken, {
        codExternal: transaction.id,
        amount,
        description: body.description ?? `Plano PIX ${body.planType}`,
        customerName: body.name,
        customerEmail: body.email,
        customerDocument: body.document.replace(/[.-]/g, ''),
        customerPhone: body.mobile_phone,
        documentType: body.document_type as 'CPF' | 'CNPJ',
      });

      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'PENDING', domPaymentId: payment.id },
      });

      const days = this.getDaysForPlan(body.planType);
      const doc = body.document.replace(/[.-]/g, '');

      // Garantir que o Customer existe para vincular ao PixPlanOrder imediatamente
      let customer = await this.prisma.customer.findFirst({
        where: { userId: effectiveUserId, document: doc },
      });

      if (!customer) {
        customer = await this.prisma.customer.create({
          data: {
            userId: effectiveUserId,
            name: body.name,
            email: body.email,
            document: doc,
            documentType: body.document_type,
            phone: body.mobile_phone,
          },
        });
      }

      await this.repo.createPixPlanOrder({
        transactionId: transaction.id,
        userId: effectiveUserId,
        customerId: customer.id, // Vínculo imediato com o ID oficial
        customerEmail: body.email,
        customerDocument: doc,
        planType: body.planType,
        daysCredited: days,
        pixCreditPlanId: body.pixCreditPlanId || null,
        paid: false,
      });

      return {
        ...payment,
        paymentId: payment.id,
        transactionId: transaction.id,
        status: 'PENDING',
      };
    } catch (error) {
      this.logger.error('Erro ao criar pagamento de plano PIX:', error);
      if (error instanceof HttpException) throw error;
      throw new BadRequestException('Erro ao processar compra do plano via PIX');
    }
  }

  // ── GET /payments/pix-plan/link-code/:code ───────────────────────────────

  async getPixPlanLinkCode(code: string) {
    const link = await this.repo.findPixPlanLinkCodeByCode(code);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link-code PIX-PLAN não encontrado ou inativo');
    }
    return link;
  }

  // ── GET /payments/pix-plan/link-code-details/:code/checkout ──────────────

  async getPixPlanLinkCodeDetailsForCheckout(code: string) {
    const link = await this.repo.findPixPlanLinkCodeByCodeWithPlan(code);
    if (!link || !link.isActive) {
      throw new NotFoundException('Link code PIX-PLAN não encontrado');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: link.pixCreditPlan.userId },
      select: { domToken: true },
    });

    return {
      id: link.id,
      code: link.code,
      pixCreditPlanId: link.pixCreditPlanId,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      plan: {
        id: link.pixCreditPlan.id,
        value: link.pixCreditPlan.price,
        frequencyType: this.mapPixTypeToFrequency(String(link.pixCreditPlan.type)),
        paymentMethods: ['pix'],
        userId: link.pixCreditPlan.userId,
        description: (link.pixCreditPlan.description ?? '').replace(/\s*\[CPF:[^\]]*\|PAGATG\]/g, ''),
        externalReference: null,
        redirectUrl: link.pixCreditPlan.redirectUrl,
        webhookUrl: link.pixCreditPlan.webhookUrl,
        domPlanId: null,
        status: link.pixCreditPlan.status,
        frequency: 1,
        retryDays: 0,
        createdAt: link.pixCreditPlan.createdAt,
        updatedAt: link.pixCreditPlan.updatedAt,
      },
      token: user?.domToken ?? null,
    };
  }

  // ── POST /payments/pix-plan/checkout-by-code ─────────────────────────────

  async createPixPlanPaymentFromCode(body: PixPlanCheckoutByCodeDto) {
    const link = await this.getPixPlanLinkCode(body.code);
    const plan = await this.repo.findPixCreditPlanById(link.pixCreditPlanId);

    if (!plan) throw new BadRequestException('Code inválido para plano PIX');

    let finalPrice = plan.price;

    if (body.voucherCode && body.voucherCode.trim()) {
      try {
        const API_PAGATG_URL = process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com';
        const voucherResponse = await fetch(
          `${API_PAGATG_URL}/webhook/validate-voucher-by-plan`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              linkCode: body.code,
              voucherCode: body.voucherCode.trim().toUpperCase(),
              amount: plan.price,
            }),
          },
        );
        const voucherData = await voucherResponse.json();
        if (voucherResponse.ok && voucherData.valid) {
          finalPrice = voucherData.finalAmount;
        }
      } catch {
        // Continuar com preço original em caso de erro
      }
    } else if (body.finalAmount !== undefined && body.finalAmount !== null) {
      finalPrice = body.finalAmount;
    }

    return this.createPixPlanPayment(plan.userId, {
      planType: plan.type,
      price: finalPrice,
      name: body.name,
      email: body.email,
      document: body.document,
      document_type: body.document_type,
      mobile_phone: body.mobile_phone,
      description: `PIX_PLAN_CODE:${link.code}${body.voucherCode ? ` (VOUCHER:${body.voucherCode})` : ''}`,
      pixCreditPlanId: plan.id,
    });
  }

  // ── POST /payments/pix-plan/:id/link-code ────────────────────────────────

  async createPixPlanLinkCodeForPlan(userId: string, pixPlanId: string, role?: string) {
    const plan = await this.repo.findPixCreditPlanById(pixPlanId);
    if (!plan || plan.status !== 'ACTIVE')
      throw new NotFoundException('Plano PIX não encontrado ou inativo');
    if (role !== 'ADMIN' && plan.userId !== userId)
      throw new BadRequestException('Plano não pertence a este usuário');

    const code = `PX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    return this.repo.createPixPlanLinkCode({
      pixCreditPlanId: plan.id,
      code,
    });
  }

  // ── GET /payments/pix-plan ───────────────────────────────────────────────

  async listPixCreditPlans(userId: string) {
    const plans = await this.repo.findPixCreditPlansByUserId(userId);
    return plans.map((p: any) => ({
      id: p.id,
      userId: p.userId,
      type: p.type,
      price: p.price,
      description: p.description,
      redirectUrl: p.redirectUrl,
      webhookUrl: p.webhookUrl,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      linkCode: p.linkCodes?.[0]?.code ?? null,
    }));
  }

  async listPixCreditPlansPaginated(params: {
    userId: string;
    role?: string;
    page: number;
    limit: number;
    status?: 'ACTIVE' | 'INACTIVE';
    search?: string;
  }) {
    const safePage = Number.isFinite(params.page) ? Math.max(1, params.page) : 1;
    const safeLimit = Number.isFinite(params.limit)
      ? Math.min(Math.max(1, params.limit), 100)
      : 10;

    const isAdmin = params.role === 'ADMIN';

    const { items, total } = await this.repo.findPixCreditPlansByUserIdPaginated({
      userId: isAdmin ? undefined : params.userId,
      page: safePage,
      limit: safeLimit,
      status: params.status,
      search: params.search,
    });

    const mappedItems = await Promise.all(items.map(async (p: any) => {
      const desc: string = p.description ?? '';

      // CPF do dono: extrair da descrição ([CPF:xxx|TAG]) — o userId do plano é conta técnica
      let cpfDono: string | null = null;
      let donoNome: string | null = null;
      let donoEmail: string | null = null;

      const descCpf = this.extractOwnerDocumentDigitsFromPlanDescription(desc);
      if (descCpf) {
        cpfDono = descCpf.length === 11
          ? descCpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
          : descCpf;
        // Nome extraído de [NOME_DONO:...] na description (formato legado dos planos antigos)
        const nomeDono = desc.match(/\[NOME_DONO:([^\]]+)\]/i)?.[1]?.trim() ?? null;
        donoNome = nomeDono;
        // Email: tentar encontrar o usuário pelo CPF no banco
        const userByCpf = await (this.prisma as any).user.findUnique({
          where: { cpf: descCpf },
          select: { email: true, name: true },
        }).catch(() => null);
        if (userByCpf) {
          donoEmail = userByCpf.email ?? null;
          if (!donoNome) donoNome = userByCpf.name ?? null;
        }
      } else {
        // Fallback: CPF do user dono (quando o plano foi criado pelo próprio merchant)
        const cpfRaw: string | null | undefined = p.user?.cpf;
        if (cpfRaw) {
          const digits = cpfRaw.replace(/\D/g, '');
          cpfDono = digits.length === 11
            ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            : cpfRaw;
        }
        donoNome = p.user?.name ?? p.user?.nome ?? null;
        donoEmail = p.user?.email ?? null;
      }

      return {
        id: p.id,
        userId: p.userId,
        type: p.type,
        price: p.price,
        description: p.description,
        redirectUrl: p.redirectUrl,
        webhookUrl: p.webhookUrl,
        status: p.status,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        linkCode: p.linkCodes?.[0]?.code ?? null,
        subscriberCount: (p._count?.accesses ?? 0) as number,
        cpfDono,
        donoNome,
        donoEmail,
        tenantTag: p.tenantTag
          ? p.tenantTag.toUpperCase()
          : (p.description ?? '').match(/\[TENANT:([^\]]+)\]/i)?.[1]?.toUpperCase()
          ?? (p.description ?? '').match(/\[CPF:[^\]|]*\|([^\]]+)\]/i)?.[1]?.toUpperCase()
          ?? null,
      };
    }));

    return {
      items: mappedItems,
      meta: {
        currentPage: safePage,
        itemsPerPage: safeLimit,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  // ── GET /payments/pix-plan/:id ──────────────────────────────────────────

  async getPixCreditPlanById(userId: string, planId: string, role?: string) {
    const plan = await this.repo.findPixCreditPlanById(planId);
    if (!plan) throw new NotFoundException('Plano PIX não encontrado');
    if (role !== 'ADMIN' && plan.userId !== userId)
      throw new BadRequestException('Plano não pertence a este usuário');

    const linkCode = await this.prisma.pixPlanLinkCode.findFirst({
      where: { pixCreditPlanId: planId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: {
        id: plan.id,
        description: plan.description ?? null,
        price: plan.price,
        frequency_type: plan.type,
        redirectUrl: plan.redirectUrl ?? null,
        webhookUrl: plan.webhookUrl ?? null,
        status: plan.status,
        tenantTag: plan.tenantTag
          ? plan.tenantTag.toUpperCase()
          : (plan.description ?? '').match(/\[TENANT:([^\]]+)\]/i)?.[1]?.toUpperCase()
          ?? (plan.description ?? '').match(/\[CPF:[^\]|]*\|([^\]]+)\]/i)?.[1]?.toUpperCase()
          ?? null,
        linkCode: linkCode?.code ?? null,
        createdAt: plan.createdAt,
      },
    };
  }

  // ── PATCH /payments/pix-plan/:id ─────────────────────────────────────────

  async updatePixCreditPlan(
    userId: string,
    planId: string,
    body: {
      description?: string;
      price?: number;
      frequency_type?: string;
      redirectUrl?: string | null;
      webhookUrl?: string | null;
      tenantTag?: string | null;
    },
    role?: string,
  ) {
    const plan = await this.repo.findPixCreditPlanById(planId);
    if (!plan) throw new NotFoundException('Plano PIX não encontrado');
    if (role !== 'ADMIN' && plan.userId !== userId)
      throw new BadRequestException('Plano não pertence a este usuário');

    const updated = await this.prisma.pixCreditPlan.update({
      where: { id: planId },
      data: {
        ...(body.description !== undefined && { description: body.description }),
        ...(body.price !== undefined && { price: body.price }),
        ...(body.frequency_type !== undefined && { type: this.mapFrequencyToType(body.frequency_type as 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR') }),
        ...(body.redirectUrl !== undefined && { redirectUrl: body.redirectUrl || null }),
        ...(body.webhookUrl !== undefined && { webhookUrl: body.webhookUrl || null }),
        ...(body.tenantTag !== undefined && { tenantTag: body.tenantTag ? body.tenantTag.toUpperCase() : null }),
      },
    });

    return { data: { id: updated.id, tenantTag: updated.tenantTag } };
  }

  // ── DELETE /payments/pix-plan/:id ────────────────────────────────────────

  async deletePixCreditPlan(userId: string, pixPlanId: string, role?: string) {
    const plan = await this.repo.findPixCreditPlanById(pixPlanId);
    if (!plan) throw new NotFoundException('Plano PIX não encontrado');
    if (role !== 'ADMIN' && plan.userId !== userId)
      throw new BadRequestException('Plano não pertence a este usuário');

    await this.prisma.$transaction(async () => {
      await this.repo.deletePixPlanLinkCodesByPlanId(pixPlanId);
      await this.repo.deletePixCreditPlan(pixPlanId);
    });

    return { success: true, message: 'Plano PIX deletado com sucesso' };
  }

  async togglePixCreditPlanStatus(userId: string, planId: string, role?: string) {
    const plan = await this.repo.findPixCreditPlanById(planId);
    if (!plan) throw new NotFoundException('Plano não encontrado');

    if (role !== 'ADMIN' && plan.userId !== userId) {
      throw new BadRequestException('Você não tem permissão para alterar este plano');
    }

    const newStatus = plan.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await this.repo.updatePixCreditPlanStatus(planId, newStatus);

    // Agora buscamos todos os acessos associados a este plano para suspender/reativar
    const associatedAccesses = await this.repo.findCustomerPlanAccessByPlanId(planId);

    const results = [];
    for (const access of associatedAccesses) {
      try {
        const toggleResult = await this.toggleCustomerPlanAccessStatus(access.id);
        results.push({ accessId: access.id, ...toggleResult });
      } catch (error) {
        results.push({ accessId: access.id, success: false, error: (error as any).message });
      }
    }

    return {
      success: true,
      newStatus,
      affectedAccesses: results.length,
      accessResults: results,
    };
  }

  // ── POST /payments/pix-plan ──────────────────────────────────────────────

  async createPixCreditPlanFromPublicDto(
    userId: string,
    body: CreatePixCreditPlanDto,
  ) {
    const type = this.mapFrequencyToType(body.frequency_type);
    const tag = body.tenantTag ? body.tenantTag.toUpperCase().trim() : null;
    const plan = await this.repo.createPixCreditPlan({
      userId,
      type,
      price: body.price,
      description: body.description,
      redirectUrl: body.redirectUrl,
      webhookUrl: body.webhookUrl,
      tenantTag: tag,
    });

    const code = `PX-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const linkCode = await this.repo.createPixPlanLinkCode({
      pixCreditPlanId: plan.id,
      code,
    });

    return { ...plan, linkCode: linkCode.code };
  }

  // ── GET /payments/plan-access ────────────────────────────────────────────

  async getPlanAccess(userId: string, customerDocument: string) {
    const doc = customerDocument.replace(/[.-]/g, '');
    const access = await this.repo.findActiveCustomerPlanAccess({
      userId,
      customerDocument: doc,
    });

    if (!access) {
      return {
        isActive: false,
        expiresAt: null,
        remainingDays: 0,
        totalDaysCredited: 0,
      };
    }

    await this.decrementPlanDays(access);
    const updatedAccess = await this.repo.findCustomerPlanAccessById(access.id);

    const now = Date.now();
    const expiresAtMs = new Date(updatedAccess.expiresAt).getTime();
    const remainingMs = Math.max(expiresAtMs - now, 0);
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

    return {
      isActive: updatedAccess.isActive && expiresAtMs > now,
      expiresAt: updatedAccess.expiresAt,
      remainingDays,
      totalDaysCredited: updatedAccess.totalDaysCredited,
    };
  }

  // ── GET /payments/admin/pix-plan-access + GET /public/pix-plan-access ────

  async listAllPixPlanAccess(params: {
    page: number;
    limit: number;
    userId?: string;
    isActive?: boolean;
    pixPlanId?: string;
  }) {
    try {
      const { page, limit } = params;
      const { items: planAccess, total } =
        await this.repo.listAllCustomerPlanAccess(params);

      const enrichedAccess = await Promise.all(
        planAccess.map(async (access: any) => {
          const now = Date.now();
          const expiresAtMs = new Date(access.expiresAt).getTime();
          const remainingMs = Math.max(expiresAtMs - now, 0);
          const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

          let pixPlanCode: string | null = null;
          if (access.lastTransactionId) {
            try {
              const transaction = await this.prisma.transaction.findUnique({
                where: { id: access.lastTransactionId },
                select: { description: true },
              });
              if (transaction?.description?.includes('PIX_PLAN_CODE:')) {
                const match = transaction.description.match(
                  /PIX_PLAN_CODE:([A-Z0-9-]+)/,
                );
                if (match) pixPlanCode = match[1];
              }
            } catch {
              // ignorar
            }
          }

          return {
            id: access.id,
            userId: access.userId,
            seller: access.user,
            customer: access.customer,
            customerEmail: access.customerEmail,
            customerDocument: access.customerDocument,
            isActive: access.isActive && expiresAtMs > now,
            expiresAt: access.expiresAt,
            remainingDays,
            totalDaysCredited: access.totalDaysCredited,
            lastTransactionId: access.lastTransactionId,
            pixPlanCode,
            createdAt: access.createdAt,
            updatedAt: access.updatedAt,
          };
        }),
      );

      return {
        planAccess: enrichedAccess,
        meta: {
          currentPage: page,
          itemsPerPage: limit,
          totalItems: total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error: any) {
      throw new HttpException(
        `Erro ao listar acessos: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── POST /payments/plan-access/decrement-all ─────────────────────────────

  async decrementAllPlanDays() {
    const activePlans = await this.repo.findAllActiveCustomerPlanAccess();
    const results = {
      processed: 0,
      expired: 0,
      updated: 0,
      errors: 0,
      details: [] as any[],
    };

    for (const plan of activePlans) {
      try {
        const beforeDays = Math.ceil(
          (new Date(plan.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
        await this.decrementPlanDays(plan);
        const updatedPlan = await this.repo.findCustomerPlanAccessById(plan.id);
        const afterDays = Math.ceil(
          (new Date(updatedPlan.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
        results.processed++;
        if (!updatedPlan.isActive) {
          results.expired++;
        } else if (beforeDays !== afterDays) {
          results.updated++;
        }
        results.details.push({
          id: plan.id,
          customerDocument: plan.customerDocument,
          customerEmail: plan.customerEmail,
          userName: plan.user?.name,
          beforeDays,
          afterDays,
          isActive: updatedPlan.isActive,
          totalDaysCredited: plan.totalDaysCredited,
        });
      } catch {
        results.errors++;
      }
    }
    return results;
  }

  /**
   * Força diretamente o estado (isActive) de todos os CustomerPlanAccess de um cliente.
   * Chamado por api-pagatg após pausar/retomar um PixCredit, para manter sincronismo.
   */
  async forceSetCustomerPlanAccessStatus(
    customerId: string,
    isActive: boolean,
    remainingDays: number,
  ): Promise<{ success: boolean; updated: number }> {
    const now = new Date();

    if (!isActive) {
      // SUSPENDER: guardar remainingDays em totalDaysCredited, zerar expiresAt
      const accesses = await (this.prisma as any).customerPlanAccess.findMany({
        where: { customerId, isActive: true },
      });
      for (const access of accesses) {
        const expiresAt = new Date(access.expiresAt);
        const diffTime = expiresAt.getTime() - now.getTime();
        const days = remainingDays > 0 ? remainingDays : Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        await (this.prisma as any).customerPlanAccess.update({
          where: { id: access.id },
          data: { isActive: false, expiresAt: now, totalDaysCredited: days, createdAt: now },
        });
      }
      return { success: true, updated: accesses.length };
    } else {
      // REATIVAR: restaurar dias guardados
      const accesses = await (this.prisma as any).customerPlanAccess.findMany({
        where: { customerId, isActive: false },
      });
      for (const access of accesses) {
        const days = remainingDays > 0 ? remainingDays : (access.totalDaysCredited ?? 0);
        if (days <= 0) continue;
        const newExpiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        await (this.prisma as any).customerPlanAccess.update({
          where: { id: access.id },
          data: { isActive: true, expiresAt: newExpiresAt, createdAt: now },
        });
      }
      return { success: true, updated: accesses.length };
    }
  }

  async toggleCustomerPlanAccessStatus(id: string, requesterRole?: string) {
    const access = await this.repo.findCustomerPlanAccessById(id);
    if (!access) throw new NotFoundException('Acesso ao plano não encontrado');

    const now = new Date();
    const isCurrentlyActive = access.isActive && new Date(access.expiresAt) > now;

    if (isCurrentlyActive) {
      // SUSPENDER
      const expiresAt = new Date(access.expiresAt);
      const diffTime = expiresAt.getTime() - now.getTime();
      const remainingDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

      await this.repo.updateCustomerPlanAccessById(id, {
        isActive: false,
        expiresAt: now, // Jacques passa a ver 0 dias imediatamente
        totalDaysCredited: remainingDays, // Guardamos os dias restantes aqui
        createdAt: now, // Resetamos o checkpoint
      });

      const result = {
        success: true,
        message: 'Acesso ao plano suspenso com sucesso',
        remainingDaysSuspended: remainingDays,
      };

      // Notificar api-pagatg da mudança de status
      try {
        const apiPagatgUrl = (process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com').replace(/\/+$/, '');
        const pagatgInternalToken = process.env.PAGATG_INTERNAL_TOKEN || '';
        await fetch(`${apiPagatgUrl}/webhook/pix-credit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
          },
          body: JSON.stringify({
            code: access.pixPlanCode || 'STATUS_UPDATE',
            email: access.customerEmail,
            customerId: access.customerId,
            status: 'SUSPENDED',
            userId: access.userId,
          }),
        });
      } catch (webhookError: any) {
        this.logger.error(`Erro ao notificar api-pagatg (SUSPENDED): ${webhookError.message}`);
      }

      return result;
    } else {
      // REATIVAR
      const daysToReturn = access.totalDaysCredited;
      if (daysToReturn <= 0) {
        throw new BadRequestException('Não há dias restantes para reativar este acesso');
      }

      const newExpiresAt = new Date(now.getTime() + daysToReturn * 24 * 60 * 60 * 1000);

      await this.repo.updateCustomerPlanAccessById(id, {
        isActive: true,
        expiresAt: newExpiresAt,
        createdAt: now,
      });

      const result = {
        success: true,
        message: 'Acesso ao plano reativado com sucesso',
        newExpiresAt,
        daysReturned: daysToReturn,
      };

      // Notificar api-pagatg da mudança de status
      try {
        const apiPagatgUrl = (process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com').replace(/\/+$/, '');
        const pagatgInternalToken = process.env.PAGATG_INTERNAL_TOKEN || '';
        await fetch(`${apiPagatgUrl}/webhook/pix-credit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
          },
          body: JSON.stringify({
            code: access.pixPlanCode || 'STATUS_UPDATE',
            email: access.customerEmail,
            customerId: access.customerId, // IDs são sincronizados
            status: 'ACTIVE',
            userId: access.userId,
          }),
        });
      } catch (webhookError: any) {
        this.logger.error(`Erro ao notificar api-pagatg (ACTIVE): ${webhookError.message}`);
      }

      return result;
    }
  }

  async decrementPlanDays(access: any) {
    const now = new Date();
    const expiresAt = new Date(access.expiresAt);

    if (expiresAt <= now && access.isActive) {
      await this.repo.updateCustomerPlanAccessById(access.id, { isActive: false });
      
      // Notificar api-pagatg da expiração automática
      try {
        const apiPagatgUrl = (process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com').replace(/\/+$/, '');
        const pagatgInternalToken = process.env.PAGATG_INTERNAL_TOKEN || '';
        await fetch(`${apiPagatgUrl}/webhook/pix-credit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
          },
          body: JSON.stringify({
            code: access.pixPlanCode || 'STATUS_UPDATE',
            email: access.customerEmail || '',
            customerId: access.customerId,
            status: 'SUSPENDED', // Expiração é tratada como suspensão de acesso
            userId: access.userId,
          }),
        });
      } catch (webhookError: any) {
        this.logger.error(`Erro ao notificar api-pagatg de expiração (SUSPENDED): ${webhookError.message}`);
      }
      return;
    }

    if (expiresAt <= now) return;

    const createdAt = new Date(access.createdAt);
    const daysSinceCreation = Math.floor(
      (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    const remainingDays = Math.max(access.totalDaysCredited - daysSinceCreation, 0);

    if (remainingDays <= 0 && access.isActive) {
      await this.repo.updateCustomerPlanAccessById(access.id, {
        isActive: false,
        expiresAt: now,
      });

      // Notificar api-pagatg da expiração automática por dias consumidos
      try {
        const apiPagatgUrl = (process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com').replace(/\/+$/, '');
        const pagatgInternalToken = process.env.PAGATG_INTERNAL_TOKEN || '';
        await fetch(`${apiPagatgUrl}/webhook/pix-credit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
          },
          body: JSON.stringify({
            code: access.pixPlanCode || 'STATUS_UPDATE',
            email: access.customerEmail || '',
            customerId: access.customerId,
            status: 'SUSPENDED',
            userId: access.userId,
          }),
        });
      } catch (webhookError: any) {
        this.logger.error(`Erro ao notificar api-pagatg de expiração por dias (SUSPENDED): ${webhookError.message}`);
      }
      return;
    }

    if (remainingDays <= 0) return;

    const newExpiresAt = new Date(now.getTime() + remainingDays * 24 * 60 * 60 * 1000);
    await this.repo.updateCustomerPlanAccessById(access.id, {
      expiresAt: newExpiresAt,
      isActive: remainingDays > 0,
    });
  }

  // ── GET /public/purchase/:transactionId ──────────────────────────────────

  async getPurchaseDetails(transactionId: string) {
    let transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        user: { select: { id: true, name: true, email: true, domToken: true } },
      },
    });

    // Se ainda PENDING, consulta DOM diretamente para status em tempo real
    if (transaction?.status === 'PENDING' && transaction.domPaymentId && transaction.user?.domToken) {
      try {
        const domTx = await this.gateway.getDomTransactionDetail(transaction.user.domToken, transaction.domPaymentId);
        const domStatus: string = domTx?.status ?? '';
        const isPaid = ['paid', 'approved', 'completed', 'revision_paid', 'capture'].includes(domStatus.toLowerCase());
        if (isPaid) {
          await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' },
          });
          transaction = { ...transaction, status: 'COMPLETED' as any };
          this.logger.log(`[getPurchaseDetails] tx ${transaction.id} marcada COMPLETED via consulta direta DOM`);
        }
      } catch {
        // ignora erro — retorna status local
      }
    }

    if (!transaction) {
      const subscription = await this.prisma.subscription.findFirst({
        where: {
          OR: [{ id: transactionId }, { domSubscriptionId: transactionId }],
        },
        include: { customer: true, plan: true, user: true },
      });
      if (subscription) {
        return {
          type: 'SUBSCRIPTION',
          transaction: null,
          subscription: {
            id: subscription.id,
            status: subscription.status,
            customer: subscription.customer
              ? {
                id: subscription.customer.id,
                name: subscription.customer.name,
                email: subscription.customer.email,
                document: subscription.customer.document,
              }
              : null,
            plan: {
              id: subscription.plan.id,
              description: subscription.plan.description,
              price: Number(subscription.plan.price),
              type: subscription.plan.type,
              redirectUrl: subscription.plan.redirectUrl ?? null,
            },
            createdAt: subscription.createdAt,
          },
        };
      }
      throw new NotFoundException('Transação não encontrada');
    }

    const pixPlanOrder = await this.repo.findPixPlanOrderByTransactionId(transaction.id);

    if (pixPlanOrder) {
      const planAccess = await (this.prisma as any).customerPlanAccess.findFirst({
        where: { lastTransactionId: transaction.id },
        include: { customer: true },
      });

      let remainingDays = 0;
      if (planAccess?.expiresAt) {
        const now = new Date();
        const expiresAt = new Date(planAccess.expiresAt);
        const diffTime = expiresAt.getTime() - now.getTime();
        remainingDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      }

      return {
        type: 'PIX_PLAN',
        transaction: {
          id: transaction.id,
          status: transaction.status,
          amount: Number(transaction.amount),
          createdAt: transaction.createdAt,
          description: transaction.description,
        },
        seller: transaction.user,
        customer: {
          email: pixPlanOrder.customerEmail,
          document: pixPlanOrder.customerDocument,
          name: planAccess?.customer?.name || null,
        },
        plan: {
          name: pixPlanOrder.pixCreditPlan?.description || `Plano ${pixPlanOrder.planType}`,
          type: pixPlanOrder.planType,
          daysCredited: pixPlanOrder.daysCredited,
          price: pixPlanOrder.pixCreditPlan?.price || Number(transaction.amount),
          code: pixPlanOrder.pixCreditPlan?.linkCodes?.[0]?.code || null,
        },
        planAccess: planAccess
          ? {
            id: planAccess.id,
            isActive: planAccess.isActive,
            expiresAt: planAccess.expiresAt,
            remainingDays,
            totalDaysCredited: planAccess.totalDaysCredited,
          }
          : null,
      };
    }

    const subscription = await this.prisma.subscription.findFirst({
      where: {
        OR: [{ id: transactionId }, { domSubscriptionId: transactionId }],
      },
      include: { customer: true, plan: true, user: true },
    });

    if (subscription) {
      return {
        type: 'SUBSCRIPTION',
        transaction: {
          id: transaction.id,
          status: transaction.status,
          amount: Number(transaction.amount),
          createdAt: transaction.createdAt,
        },
        subscription: {
          id: subscription.id,
          status: subscription.status,
          customer: subscription.customer
            ? {
              id: subscription.customer.id,
              name: subscription.customer.name,
              email: subscription.customer.email,
              document: subscription.customer.document,
            }
            : null,
          plan: {
            id: subscription.plan.id,
            description: subscription.plan.description,
            price: Number(subscription.plan.price),
            type: subscription.plan.type,
            redirectUrl: subscription.plan.redirectUrl ?? null,
          },
          createdAt: subscription.createdAt,
        },
      };
    }

    return {
      type: 'UNKNOWN',
      transaction: {
        id: transaction.id,
        status: transaction.status,
        amount: Number(transaction.amount),
        createdAt: transaction.createdAt,
        description: transaction.description,
      },
      seller: transaction.user,
    };
  }

  // ── Webhook handler (chamado pelo ProcessWebhookUseCase) ─────────────────

  async handlePixPlanWebhook(
    transactionId: string,
    customerData: {
      name: string;
      email: string;
      document: string;
      document_type: string;
      mobile_phone?: string;
    },
  ) {
    const pixOrder = await this.repo.findPixPlanOrderByTransactionId(transactionId);
    if (!pixOrder || pixOrder.paid) return;

    this.logger.log(`PIX-PLAN: Creditando ${pixOrder.daysCredited} dias (${pixOrder.planType})`);

    const doc = customerData.document.replace(/[.-]/g, '');
    const now = new Date();

    // Garantir Customer
    let customer = await this.prisma.customer.findFirst({
      where: { userId: pixOrder.userId, document: doc },
    });

    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          userId: pixOrder.userId,
          name: customerData.name,
          email: customerData.email,
          document: doc,
          documentType: customerData.document_type,
          phone: customerData.mobile_phone,
        },
      });
    }

    const pixPlanIdToUse = pixOrder.pixCreditPlanId || pixOrder.planType;

    let pixPlanLinkCode: string | null = null;
    if (pixOrder.pixCreditPlanId) {
      const pixPlan = await this.repo.findPixCreditPlanById(pixOrder.pixCreditPlanId);
      if (pixPlan) {
        const linkCodes = await (this.prisma as any).pixPlanLinkCode.findFirst({
          where: { pixCreditPlanId: pixOrder.pixCreditPlanId },
        });
        pixPlanLinkCode = linkCodes?.code || null;
      }
    }

    const existing = await this.repo.findCustomerPlanAccess({
      userId: pixOrder.userId,
      customerDocument: doc,
      pixPlanId: pixPlanIdToUse,
    });

    const additionalDays = pixOrder.daysCredited;

    if (existing) {
      const base = new Date(existing.expiresAt) > now ? new Date(existing.expiresAt) : now;
      const newExpiresAt = new Date(base.getTime() + additionalDays * 24 * 60 * 60 * 1000);

      await this.repo.updateCustomerPlanAccess(
        {
          userId: pixOrder.userId,
          customerDocument: doc,
          pixPlanId: pixPlanIdToUse,
        },
        {
          isActive: true,
          expiresAt: newExpiresAt,
          totalDaysCredited: existing.totalDaysCredited + additionalDays,
          lastTransactionId: transactionId,
          customerId: customer.id,
          pixPlanCode: pixPlanLinkCode || existing.pixPlanCode,
        },
      );
    } else {
      const newExpiresAt = new Date(now.getTime() + additionalDays * 24 * 60 * 60 * 1000);

      await this.repo.createCustomerPlanAccess({
        userId: pixOrder.userId,
        customerId: customer.id,
        customerEmail: pixOrder.customerEmail,
        customerDocument: doc,
        pixPlanId: pixPlanIdToUse,
        pixPlanCode: pixPlanLinkCode,
        isActive: true,
        expiresAt: newExpiresAt,
        totalDaysCredited: additionalDays,
        lastTransactionId: transactionId,
      });
    }

    await this.repo.updatePixPlanOrderPaid(transactionId, {
      paid: true,
      creditedAt: new Date(),
      customerId: customer.id,
    });

    // Notificar api-pagatg
    try {
      let linkCodeForNotification = pixPlanLinkCode;
      if (!linkCodeForNotification && pixOrder.pixCreditPlanId) {
        const foundLinkCode = await (this.prisma as any).pixPlanLinkCode.findFirst({
          where: { pixCreditPlanId: pixOrder.pixCreditPlanId },
        });
        linkCodeForNotification = foundLinkCode?.code || null;
      }
      if (linkCodeForNotification) {
        const apiPagatgUrl = (process.env.API_PAGATG_URL || 'https://api-bot.jbmidia.com').replace(/\/+$/, '');
        const pagatgInternalToken = process.env.PAGATG_INTERNAL_TOKEN || '';
        await fetch(`${apiPagatgUrl}/webhook/pix-credit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(pagatgInternalToken ? { 'x-pagatg-internal-token': pagatgInternalToken } : {}),
          },
          body: JSON.stringify({
            code: linkCodeForNotification,
            email: pixOrder.customerEmail,
            customerId: customer.id,
            status: 'COMPLETED',
            userId: pixOrder.userId,
          }),
        });
      }
    } catch (webhookError: any) {
      this.logger.error('Erro ao notificar api-pagatg:', webhookError.message);
    }

    this.logger.log('PIX-PLAN: Crédito de dias concluído com sucesso!');
  }
}
