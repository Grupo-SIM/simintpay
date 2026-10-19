import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { buildResetTokenSecret } from '../../application/use-cases/auth/forgot-password.use-case';
import { isValidDocument } from '../../application/validators/is-document.validator';
import { resolveLegacyMerchantPlatform } from './legacy-merchant-platform';
import { ProvisionDeliveryOwnerDto } from './provision-delivery-owner.dto';

@Injectable()
export class ProvisionDeliveryOwnerService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService, private readonly jwt: JwtService) {}

  async execute(integrationKey: string, externalMerchantId: string, input: ProvisionDeliveryOwnerDto) {
    if (!integrationKey.startsWith('sim-delivery_') || !externalMerchantId.trim()) throw new BadRequestException('Integração Sim Delivery inválida');
    await resolveLegacyMerchantPlatform(this.prisma, integrationKey);
    const email = input.email.trim().toLowerCase();
    const legalName = input.legalName.trim();
    const cnpj = input.cnpj == null ? null : input.cnpj.replace(/\D/g, '');
    if (!legalName || (cnpj !== null && (cnpj.length !== 14 || !isValidDocument(cnpj)))) throw new BadRequestException('Nome ou CNPJ inválido');
    if (input.password !== undefined && Buffer.byteLength(input.password, 'utf8') > 72) throw new BadRequestException('Senha excede 72 bytes suportados pela SimIntPay');
    if (!input.password && !process.env.JWT_SECRET) throw new BadRequestException('JWT_SECRET não configurado para definição de senha');
    // Password is used only for a new account. Retries never reset existing credentials.
    let result: { id: string; user: { id: string; name: string; email: string; password: string } };
    try {
      result = await this.prisma.$transaction(async tx => {
        const existing = await tx.integrationMerchant.findUnique({
          where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } }, include: { user: true },
        });
        if (existing) {
          if (existing.user.email !== email) throw new ConflictException('Primeiro dono já vinculado com outro email');
          if (!existing.user.isActive || existing.user.isPurged) throw new ConflictException('Conta vinculada inativa; exige revisão administrativa');
          if (cnpj) {
            const owner = await tx.user.findUnique({ where: { cnpj } });
            if (owner && owner.id !== existing.userId) throw new ConflictException('CNPJ já pertence a outra conta');
          }
          const user = await tx.user.update({ where: { id: existing.userId }, data: { name: legalName, ...(cnpj && { cnpj, isCompany: true }) } });
          await tx.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
          return { ...await tx.integrationMerchant.update({ where: { id: existing.id }, data: { legalName, ...(cnpj && { cnpj }) } }), user };
        }
        // Never claim an unrelated account by knowing its email or CNPJ.
        if (await tx.user.findUnique({ where: { email } })) throw new ConflictException('Email já cadastrado na SimIntPay');
        if (cnpj && await tx.user.findUnique({ where: { cnpj } })) throw new ConflictException('CNPJ já pertence a outra conta');
        const password = await hash(input.password ?? randomBytes(32).toString('hex'), 10);
        const user = await tx.user.create({ data: { email, name: legalName, password, isActive: true, isCompany: !!cnpj, ...(cnpj && { cnpj }), wallet: { create: {} } } });
        const merchant = await tx.integrationMerchant.create({ data: { integrationKey, externalMerchantId, legalName, cnpj, userId: user.id } });
        return { ...merchant, user };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email, CNPJ ou primeiro dono já vinculado; tente novamente');
      throw error;
    }
    // Sending after commit allows a failed delivery to be retried without duplicate accounts.
    if (!input.password) {
      if (!process.env.JWT_SECRET) throw new BadRequestException('JWT_SECRET não configurado para definição de senha');
      const token = await this.jwt.signAsync({ sub: result.user.id, type: 'pwreset' }, { secret: buildResetTokenSecret(result.user.password), expiresIn: '1h' });
      const base = (process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'https://www.simintpay.com').replace(/\/+$/, '');
      await this.email.sendPasswordReset({ to: email, name: result.user.name, resetUrl: `${base}/redefinir-senha?token=${encodeURIComponent(token)}` });
    }
    return { id: result.id };
  }
}
