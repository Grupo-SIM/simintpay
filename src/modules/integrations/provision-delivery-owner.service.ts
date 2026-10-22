import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { buildResetTokenSecret } from '../../application/use-cases/auth/forgot-password.use-case';
import { isValidDocument } from '../../application/validators/is-document.validator';
import { deliveryAccessResult, ensureDeliveryAccess } from './delivery-canonical-access';
import { reserveDeliveryPlatform } from './delivery-platform-registration';
import { ensureDeliveryOwnerPlatform } from './delivery-owner-platform';
import { initializePlatformRegistryCache } from '../module.registry';
import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../platform-integrations/platform-integrations.store';
import { ProvisionDeliveryOwnerDto } from './provision-delivery-owner.dto';

@Injectable()
export class ProvisionDeliveryOwnerService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailService, private readonly jwt: JwtService) {}

  async reservePlatform(integrationKey: string, externalMerchantId: string, legalName: string) {
    if (typeof legalName !== 'string') throw new BadRequestException('Nome obrigatório');
    try {
      const registration = await this.prisma.$transaction(tx => reserveDeliveryPlatform(tx, integrationKey, externalMerchantId, legalName));
      return { id: registration.platformId ?? registration.id, status: registration.platformId ? 'READY' : 'PENDING_OWNER' };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Integração já reservada para outra empresa');
      throw error;
    }
  }

  async execute(integrationKey: string, externalMerchantId: string, input: ProvisionDeliveryOwnerDto, canonical = false) {
    if (!integrationKey.startsWith('sim-delivery_') || !externalMerchantId.trim()) throw new BadRequestException('Integração Sim Delivery inválida');
    const email = input.email.trim().toLowerCase();
    const legalName = input.legalName.trim();
    const cnpj = input.cnpj == null ? null : input.cnpj.replace(/\D/g, '');
    if (!legalName || (cnpj !== null && (!isValidDocument(cnpj)))) throw new BadRequestException('Nome ou CPF/CNPJ inválido');
    const documentWhere = cnpj?.length === 11 ? { cpf: cnpj } : { cnpj: cnpj! };
    const documentData = !cnpj ? {} : cnpj.length === 11 ? { cpf: cnpj, cnpj: null, isCompany: false } : { cpf: null, cnpj, isCompany: true };
    if (input.password !== undefined && Buffer.byteLength(input.password, 'utf8') > 72) throw new BadRequestException('Senha excede 72 bytes suportados pela SimIntPay');
    if (!input.password && !process.env.JWT_SECRET) throw new BadRequestException('JWT_SECRET não configurado para definição de senha');
    // Password is used only for a new account. Retries never reset existing credentials.
    let result: { id: string; user: { id: string; name: string; email: string; password: string } };
    try {
      result = await this.prisma.$transaction(async tx => {
        const registration = await tx.deliveryPlatformRegistration.findUnique({ where: { externalMerchantId } });
        const canonicalMerchant = registration?.platformId ? await tx.integrationMerchant.findUnique({
          where: { integrationKey_externalMerchantId: { integrationKey: `platform:${registration.platformId}`, externalMerchantId } }, include: { user: true },
        }) : null;
        const existing = canonicalMerchant ?? await tx.integrationMerchant.findUnique({
          where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } }, include: { user: true },
        });
        if (existing) {
          if (existing.user.email !== email) throw new ConflictException('Primeiro dono já vinculado com outro email');
          if (!existing.user.isActive || existing.user.isPurged) throw new ConflictException('Conta vinculada inativa; exige revisão administrativa');
          if (cnpj) {
            const owner = await tx.user.findUnique({ where: documentWhere });
            if (owner && owner.id !== existing.userId) throw new ConflictException('CPF/CNPJ já pertence a outra conta');
          }
          const user = await tx.user.update({ where: { id: existing.userId }, data: { name: legalName, ...documentData } });
          await tx.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
          const platform = await ensureDeliveryOwnerPlatform(tx, integrationKey, externalMerchantId, user.id, legalName);
          const merchant = await tx.integrationMerchant.update({ where: { id: existing.id }, data: { legalName, ...(cnpj && { cnpj }) } });
          const access = canonical ? await ensureDeliveryAccess(tx, platform.id, { id: merchant.id, externalMerchantId }) : null;
          return { ...merchant, user, ...(access ? deliveryAccessResult(access, await tx.platform.findUniqueOrThrow({ where: { id: platform.id } }), merchant) : {}) };
        }
        // Never claim an unrelated account by knowing its email or CNPJ.
        if (await tx.user.findUnique({ where: { email } })) throw new ConflictException('Email já cadastrado na SimIntPay');
        if (cnpj && await tx.user.findUnique({ where: documentWhere })) throw new ConflictException('CPF/CNPJ já pertence a outra conta');
        const password = await hash(input.password ?? randomBytes(32).toString('hex'), 10);
        const user = await tx.user.create({ data: { email, name: legalName, password, isActive: true, isCompany: cnpj?.length === 14, ...documentData, wallet: { create: {} } } });
        const platform = await ensureDeliveryOwnerPlatform(tx, integrationKey, externalMerchantId, user.id, legalName);
        const merchant = await tx.integrationMerchant.create({ data: { integrationKey: canonical ? `platform:${platform.id}` : integrationKey, externalMerchantId, legalName, cnpj, userId: user.id } });
        const access = canonical ? await ensureDeliveryAccess(tx, platform.id, merchant) : null;
        return { ...merchant, user, ...(access ? deliveryAccessResult(access, await tx.platform.findUniqueOrThrow({ where: { id: platform.id } }), merchant) : {}) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new ConflictException('Cadastro concorrente; tente novamente');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Email, CPF/CNPJ ou primeiro dono já vinculado; tente novamente');
      throw error;
    }
    invalidatePlatformIntegrationsCache();
    await Promise.all([initializePlatformRegistryCache(this.prisma), initializePlatformIntegrationsCache(this.prisma)]);
    // Sending after commit allows a failed delivery to be retried without duplicate accounts.
    if (!input.password) {
      if (!process.env.JWT_SECRET) throw new BadRequestException('JWT_SECRET não configurado para definição de senha');
      const token = await this.jwt.signAsync({ sub: result.user.id, type: 'pwreset' }, { secret: buildResetTokenSecret(result.user.password), expiresIn: '1h' });
      const base = (process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'https://www.simintpay.com').replace(/\/+$/, '');
      await this.email.sendPasswordReset({ to: email, name: result.user.name, resetUrl: `${base}/redefinir-senha?token=${encodeURIComponent(token)}` });
    }
    if (canonical) {
      const access = result as typeof result & ReturnType<typeof deliveryAccessResult>;
      return { id: result.id, status: 'READY', platform: access.platform, merchant: access.merchant, credentials: access.credentials };
    }
    return { id: result.id };
  }
}
