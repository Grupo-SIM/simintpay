import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type {
  CreateVoucherDto,
  UpdateVoucherDto,
  ValidateVoucherDto,
  RecordVoucherUsageDto,
} from '../../dtos/voucher/voucher.dto';

const DEFAULT_VALID_UNTIL = '9999-12-31T23:59:59.999Z';

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listVouchers(userId: string, role: string) {
    const where = role === 'ADMIN' ? {} : { userId };
    const vouchers = await (this.prisma as any).voucher.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { data: vouchers };
  }

  async createVoucher(userId: string, dto: CreateVoucherDto) {
    const codeUpper = dto.code.toUpperCase().trim();

    const existing = await (this.prisma as any).voucher.findFirst({
      where: { code: codeUpper },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'Código de voucher já existe',
        code: 'VOUCHER_CODE_EXISTS',
      });
    }

    const validUntil =
      dto.validUntil == null || String(dto.validUntil).trim() === ''
        ? new Date(DEFAULT_VALID_UNTIL)
        : new Date(dto.validUntil);

    const voucher = await (this.prisma as any).voucher.create({
      data: {
        userId,
        code: codeUpper,
        description: dto.description ?? null,
        discountType: dto.discountType as DiscountType,
        discountValue: dto.discountValue,
        maxUsage: dto.maxUsage ?? null,
        maxDiscountValue: dto.maxDiscountValue ?? null,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
        validUntil,
        applicablePlans: dto.applicablePlans ?? [],
        minOrderValue: dto.minOrderValue ?? null,
        allowedChannels: dto.allowedChannels ?? ['PAGATG'],
        allowedLinkCodes: dto.allowedLinkCodes ?? [],
      },
    });

    return voucher;
  }

  async updateVoucher(userId: string, role: string, voucherId: string, dto: UpdateVoucherDto) {
    const voucher = await (this.prisma as any).voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');
    if (role !== 'ADMIN' && voucher.userId !== userId) {
      throw new NotFoundException('Voucher não encontrado');
    }

    const updateData: any = { ...dto };
    if (dto.validUntil != null) updateData.validUntil = new Date(dto.validUntil);
    if (dto.validFrom != null) updateData.validFrom = new Date(dto.validFrom);
    if (dto.discountType) updateData.discountType = dto.discountType as DiscountType;
    if (dto.allowedLinkCodes !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      updateData['allowedLinkCodes'] = dto.allowedLinkCodes;
    }

    const updated = await (this.prisma as any).voucher.update({
      where: { id: voucherId },
      data: updateData,
    });

    return updated;
  }

  async deleteVoucher(userId: string, role: string, voucherId: string) {
    const voucher = await (this.prisma as any).voucher.findUnique({ where: { id: voucherId } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');
    if (role !== 'ADMIN' && voucher.userId !== userId) {
      throw new NotFoundException('Voucher não encontrado');
    }

    await (this.prisma as any).voucher.delete({ where: { id: voucherId } });
    return { deleted: true };
  }

  async validateVoucher(userId: string, dto: ValidateVoucherDto) {
    const finalCode = (dto.code || dto.voucherCode || '').toUpperCase().trim();
    const now = new Date();

    if (!finalCode) {
      throw new BadRequestException('Código do voucher não informado');
    }

    let searchUserId = userId;

    // Se houver linkCode ou planId, o voucher deve pertencer ao dono do recurso
    if (dto.linkCode || dto.planId) {
      // Tenta buscar no PixCreditPlan
      const pixPlan = await this.prisma.pixCreditPlan.findFirst({
        where: {
          OR: [
            { id: dto.planId || undefined },
            {
              linkCodes: {
                some: {
                  code: {
                    equals: dto.linkCode?.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            },
          ],
        },
        select: { userId: true, description: true },
      });

      if (pixPlan) {
        // Resolve o dono real do plano (lógica de shadow user)
        searchUserId = await this.resolveEffectiveMerchantId(pixPlan.userId, pixPlan.description);
      } else {
        // Tenta buscar no SubscriptionLink (LinkAssinatura)
        const subLink = await (this.prisma as any).subscriptionLink.findFirst({
          where: {
            OR: [
              { id: dto.planId || undefined },
              {
                code: {
                  equals: dto.linkCode?.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          },
          select: { userId: true },
        });
        if (subLink) {
          searchUserId = subLink.userId;
        }
      }
    }

    const voucher = await (this.prisma as any).voucher.findFirst({
      where: { userId: searchUserId, code: finalCode },
    });

    if (!voucher) {
      throw new BadRequestException('Voucher não encontrado ou inválido');
    }

    if (!voucher.isActive) {
      throw new BadRequestException('Voucher inativo');
    }

    if (voucher.validFrom && now < voucher.validFrom) {
      throw new BadRequestException('Voucher ainda não está válido');
    }

    if (voucher.validUntil && now > voucher.validUntil) {
      throw new BadRequestException('Voucher expirado');
    }

    if (voucher.maxUsage != null && voucher.usageCount >= voucher.maxUsage) {
      throw new BadRequestException('Voucher atingiu o limite de uso');
    }

    if (voucher.minOrderValue != null && dto.amount < voucher.minOrderValue) {
      throw new BadRequestException(
        `Valor mínimo do pedido para este voucher é R$ ${voucher.minOrderValue.toFixed(2)}`,
      );
    }

    if (
      voucher.allowedChannels.length > 0 &&
      dto.channel &&
      !voucher.allowedChannels.includes(dto.channel)
    ) {
      throw new BadRequestException('Voucher não válido para este canal');
    }

    const applicablePlans = voucher.applicablePlans ?? [];
    if (applicablePlans.length > 0) {
      if (!dto.planId) {
        throw new BadRequestException('Este voucher requer um plano específico');
      }
      if (!applicablePlans.includes(dto.planId)) {
        throw new BadRequestException('Voucher não é válido para este plano');
      }
    }

    const voucherAllowedLinkCodes = (voucher.allowedLinkCodes as string[]) ?? [];
    if (voucherAllowedLinkCodes.length > 0) {
      if (!dto.linkCode) {
        throw new BadRequestException('Este voucher requer um link de checkout específico');
      }
      const isAllowed = voucherAllowedLinkCodes.some(
        (c) => c.trim().toLowerCase() === dto.linkCode?.trim().toLowerCase()
      );
      if (!isAllowed) {
        throw new BadRequestException('Código de voucher inválido para este link');
      }
    }

    let discountAmount: number;
    if (voucher.discountType === 'PERCENTAGE') {
      discountAmount = (dto.amount * voucher.discountValue) / 100;
      if (voucher.maxDiscountValue != null && discountAmount > voucher.maxDiscountValue) {
        discountAmount = voucher.maxDiscountValue;
      }
    } else {
      discountAmount = voucher.discountValue;
    }

    discountAmount = Math.min(discountAmount, dto.amount);
    const finalAmount = Math.max(0, dto.amount - discountAmount);

    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discountAmount: Number(discountAmount.toFixed(2)),
      finalAmount: Number(finalAmount.toFixed(2)),
      originalAmount: dto.amount,
    };
  }

  /**
   * Valida voucher sem filtro de userId — usado em checkout público onde o
   * comprador não é o dono do voucher. Busca pelo code globalmente e valida
   * as regras de negócio (isActive, expiração, canal, limite de uso).
   */
  async validateVoucherPublic(dto: {
    code: string;
    amount: number;
    channel?: string;
    planId?: string;
    linkCode?: string;
    targetOwnerId?: string;
  }) {
    const finalCode = dto.code.toUpperCase().trim();
    const now = new Date();

    // Se houver targetOwnerId, resolve o dono real caso seja um usuário shadow (para planos PIX)
    let resolvedOwnerId = dto.targetOwnerId;
    if (resolvedOwnerId) {
      // Se tivermos o ID do plano, buscamos a descrição para resolver shadow user
      let description: string | null = null;
      if (dto.planId) {
        const plan = await this.prisma.pixCreditPlan.findUnique({
          where: { id: dto.planId },
          select: { description: true },
        });
        description = plan?.description ?? null;
      }
      resolvedOwnerId = await this.resolveEffectiveMerchantId(resolvedOwnerId, description);
    }

    const voucher = await (this.prisma as any).voucher.findFirst({
      where: {
        code: finalCode,
        isActive: true,
        // Se resolvedOwnerId for fornecido, garante que o voucher pertence a esse dono
        ...(resolvedOwnerId ? { userId: resolvedOwnerId } : {}),
      },
    });

    if (!voucher) throw new BadRequestException('Código de voucher inválido');

    if (voucher.validFrom && now < voucher.validFrom) {
      throw new BadRequestException('Código de voucher inválido');
    }
    if (voucher.validUntil && now > voucher.validUntil) {
      throw new BadRequestException('Código de voucher inválido');
    }
    if (voucher.maxUsage != null && voucher.usageCount >= voucher.maxUsage) {
      throw new BadRequestException('Código de voucher inválido');
    }
    if (voucher.minOrderValue != null && dto.amount < voucher.minOrderValue) {
      throw new BadRequestException(
        `Valor mínimo do pedido para este voucher é R$ ${voucher.minOrderValue.toFixed(2)}`,
      );
    }
    if (
      voucher.allowedChannels.length > 0 &&
      dto.channel &&
      !voucher.allowedChannels.includes(dto.channel)
    ) {
      throw new BadRequestException('Código de voucher inválido');
    }
    const applicablePlans = voucher.applicablePlans ?? [];
    if (applicablePlans.length > 0) {
      if (!dto.planId) {
        throw new BadRequestException('Este voucher requer um plano específico');
      }
      if (!applicablePlans.includes(dto.planId)) {
        throw new BadRequestException('Voucher não é válido para este plano');
      }
    }
    // Se o voucher tem canais específicos (link codes) e um linkCode foi informado,
    // verifica se o linkCode pertence a algum dos canais permitidos
    const allowedLinkCodes: string[] = Array.isArray(voucher.allowedLinkCodes)
      ? (voucher.allowedLinkCodes as string[])
      : [];

    if (allowedLinkCodes.length > 0) {
      if (!dto.linkCode) {
        throw new BadRequestException('Este voucher requer um link de checkout específico');
      }
      const isAllowed = allowedLinkCodes.some(
        (c) => c.trim().toLowerCase() === dto.linkCode?.trim().toLowerCase()
      );
      if (!isAllowed) {
        throw new BadRequestException('Código de voucher inválido para este link');
      }
    }

    let discountAmount: number;
    if (voucher.discountType === 'PERCENTAGE') {
      discountAmount = (dto.amount * voucher.discountValue) / 100;
      if (voucher.maxDiscountValue != null && discountAmount > voucher.maxDiscountValue) {
        discountAmount = voucher.maxDiscountValue;
      }
    } else {
      discountAmount = voucher.discountValue;
    }

    discountAmount = Math.min(discountAmount, dto.amount);
    const finalAmount = Math.max(0, dto.amount - discountAmount);

    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discountAmount: Number(discountAmount.toFixed(2)),
      finalAmount: Number(finalAmount.toFixed(2)),
      originalAmount: dto.amount,
    };
  }

  async recordUsage(dto: RecordVoucherUsageDto) {
    const voucher = await (this.prisma as any).voucher.findUnique({ where: { id: dto.voucherId } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');

    await this.prisma.$transaction([
      (this.prisma as any).voucherUsage.create({
        data: {
          voucherId: dto.voucherId,
          transactionId: dto.transactionId ?? null,
          subscriptionId: dto.subscriptionId ?? null,
          customerEmail: dto.customerEmail,
          customerDocument: dto.customerDocument,
          originalAmount: dto.originalAmount,
          discountAmount: dto.discountAmount,
          finalAmount: dto.finalAmount,
        },
      }),
      (this.prisma as any).voucher.update({
        where: { id: dto.voucherId },
        data: { usageCount: { increment: 1 } },
      }),
    ]);

    return { recorded: true };
  }

  /**
   * Resolve o ID real do merchant caso o userId atual pertença a um usuário 'shadow'
   * (técnico/automático) criado por integrações como api-pagatg.
   */
  private async resolveEffectiveMerchantId(userId: string, description?: string | null): Promise<string> {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, id: true },
    });

    // Se não for usuário shadow (@auto.simpay.com), retorna o próprio userId
    if (!owner || !(owner.email ?? '').toLowerCase().endsWith('@auto.simpay.com')) {
      return userId;
    }

    // Tenta extrair CPF da descrição: [CPF:xxx|TAG]
    const m = (description ?? '').match(/\[CPF:([^\]|]*)\|[^\]]+\]/);
    if (!m) return userId;

    const digits = m[1].replace(/\D/g, '');
    if (digits.length < 11) return userId;

    // Busca usuário real pelo CPF
    const variants: string[] = [digits];
    if (digits.length === 11) {
      variants.push(digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    } else if (digits.length === 14) {
      variants.push(digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));
    }

    const realUser = await this.prisma.user.findFirst({
      where: { OR: variants.map((cpf) => ({ cpf })) },
      select: { id: true },
    });

    return realUser?.id ?? userId;
  }
}
