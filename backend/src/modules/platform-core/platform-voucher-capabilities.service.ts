import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { VoucherService } from '../../application/use-cases/voucher/voucher.service';
import { PlatformContextService, type PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';
import type { PlatformVoucherDto, PlatformVoucherUpdateDto, PlatformVoucherValidationDto } from './platform-voucher.dto';

type VoucherContract = { id: string; code: string; discountType: string; discountValue: number | string | Prisma.Decimal; isActive: boolean; description?: string | null };

@Injectable()
export class PlatformVoucherCapabilitiesService {
  constructor(private readonly prisma: PrismaService, private readonly contexts: PlatformContextService, private readonly modules: ModuleRef) {}

  private async current(context: PlatformContext) {
    const current = await this.contexts.resolve(context.tag);
    if (current.tag !== 'PAGATG') unsupportedCapability('vouchers');
    if (current.id !== context.id || current.ownerUserId !== context.ownerUserId) throw new BadRequestException('Contexto da plataforma mudou');
    return current;
  }
  private vouchers() { return this.modules.get(VoucherService, { strict: false }); }
  private result(voucher: VoucherContract) {
    return { id: voucher.id, code: voucher.code, description: voucher.description ?? null, discountType: voucher.discountType,
      ...(voucher.discountType === 'PERCENTAGE' ? { discountRate: new Prisma.Decimal(voucher.discountValue).div(100).toNumber() }
        : { discountAmountCents: new Prisma.Decimal(voucher.discountValue).mul(100).toNumber() }), isActive: voucher.isActive };
  }
  async list(context: PlatformContext) {
    const current = await this.current(context);
    const vouchers = await this.prisma.voucher.findMany({ where: { userId: current.ownerUserId, allowedChannels: { has: 'PAGATG' } }, orderBy: { createdAt: 'desc' } });
    return { data: vouchers.map(voucher => this.result(voucher)) };
  }
  async create(context: PlatformContext, body: PlatformVoucherDto) {
    const current = await this.current(context);
    const value = body.discountType === 'PERCENTAGE' ? new Prisma.Decimal(body.discountRate ?? -1).mul(100).toNumber()
      : new Prisma.Decimal(body.discountAmountCents ?? -1).div(100).toNumber();
    if (!Number.isFinite(value) || value < 0 || body.discountType === 'PERCENTAGE' && value > 100
      || body.discountType === 'FIXED' && !Number.isSafeInteger(body.discountAmountCents)) throw new BadRequestException('Desconto inválido');
    const voucher = await this.vouchers().createVoucher(current.ownerUserId, { code: body.code, description: body.description,
      discountType: body.discountType, discountValue: value, maxUsage: body.maxUsage, allowedChannels: ['PAGATG'] });
    return this.result(voucher);
  }
  async validate(context: PlatformContext, body: PlatformVoucherValidationDto) {
    const current = await this.current(context);
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents < 0) throw new BadRequestException('amountCents inválido');
    const voucher = await this.prisma.voucher.findFirst({ where: { userId: current.ownerUserId, code: body.code.toUpperCase().trim(), allowedChannels: { has: 'PAGATG' } } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');
    const result = await this.vouchers().validateVoucher(current.ownerUserId, {
      code: body.code, amount: new Prisma.Decimal(body.amountCents).div(100).toNumber(), channel: 'PAGATG',
    });
    return { valid: result.valid, voucherId: result.voucherId, code: result.code,
      originalAmountCents: body.amountCents, discountAmountCents: new Prisma.Decimal(result.discountAmount).mul(100).toNumber(),
      finalAmountCents: new Prisma.Decimal(result.finalAmount).mul(100).toNumber() };
  }
  async delete(context: PlatformContext, id: string) {
    const current = await this.current(context);
    const voucher = await this.prisma.voucher.findFirst({ where: { id, userId: current.ownerUserId, allowedChannels: { has: 'PAGATG' } } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');
    return this.vouchers().deleteVoucher(current.ownerUserId, 'USER', id);
  }
  async update(context: PlatformContext, id: string, body: PlatformVoucherUpdateDto) {
    const current = await this.current(context);
    if (!body || Object.keys(body).some(key => !['code', 'discountType', 'discountRate', 'discountAmountCents', 'description', 'maxUsage', 'isActive'].includes(key))) throw new BadRequestException('Contrato de voucher inválido');
    if (body.code !== undefined && (typeof body.code !== 'string' || !body.code.trim())
      || body.discountType !== undefined && !['FIXED', 'PERCENTAGE'].includes(body.discountType)
      || body.description !== undefined && typeof body.description !== 'string'
      || body.isActive !== undefined && typeof body.isActive !== 'boolean'
      || body.maxUsage !== undefined && (!Number.isSafeInteger(body.maxUsage) || body.maxUsage < 1)) throw new BadRequestException('Contrato de voucher inválido');
    const voucher = await this.prisma.voucher.findFirst({ where: { id, userId: current.ownerUserId, allowedChannels: { has: 'PAGATG' } } });
    if (!voucher) throw new NotFoundException('Voucher não encontrado');
    const type = body.discountType ?? voucher.discountType;
    const hasRate = body.discountRate !== undefined, hasAmount = body.discountAmountCents !== undefined;
    if (hasRate && type !== 'PERCENTAGE' || hasAmount && type !== 'FIXED' || body.discountType && body.discountType !== voucher.discountType && !hasRate && !hasAmount) throw new BadRequestException('Unidade de desconto inválida');
    if (hasRate && (!Number.isFinite(body.discountRate) || body.discountRate! < 0 || body.discountRate! > 1)
      || hasAmount && (!Number.isSafeInteger(body.discountAmountCents) || body.discountAmountCents! < 0)) throw new BadRequestException('Desconto inválido');
    const { discountRate, discountAmountCents, ...patch } = body;
    const discountValue = hasRate ? new Prisma.Decimal(discountRate!).mul(100).toNumber() : hasAmount ? new Prisma.Decimal(discountAmountCents!).div(100).toNumber() : undefined;
    const result = await this.vouchers().updateVoucher(current.ownerUserId, 'USER', id, {
      ...patch, ...(body.code !== undefined ? { code: body.code.toUpperCase().trim() } : {}),
      ...(discountValue !== undefined ? { discountValue } : {}), allowedChannels: ['PAGATG'],
    });
    return this.result(result);
  }
}
