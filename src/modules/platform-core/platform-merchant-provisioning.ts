import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isValidDocument } from '../../application/validators/is-document.validator';

/** Shared persistence for explicitly provisioned merchant accounts. */
export class PlatformMerchantProvisioning {
  constructor(private readonly prisma: PrismaService) {}
  private cleanCnpj(value: string) {
    const cnpj = String(value ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14 || !isValidDocument(cnpj)) throw new BadRequestException('CNPJ inválido');
    return cnpj;
  }
  async provision(integrationKey: string, externalMerchantId: string, input: { cnpj: string; legalName: string }) {
    const cnpj = this.cleanCnpj(input.cnpj);
    const legalName = input.legalName?.trim();
    if (!integrationKey.trim() || !externalMerchantId.trim() || !legalName) {
      throw new BadRequestException('Integração, merchant externo e razão social são obrigatórios');
    }

    const existing = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_externalMerchantId: { integrationKey, externalMerchantId } },
    });
    if (existing) {
      const clash = await this.prisma.integrationMerchant.findUnique({
        where: { integrationKey_cnpj: { integrationKey, cnpj } },
      });
      if (clash && clash.id !== existing.id) {
        throw new ConflictException('CNPJ já vinculado a outro merchant nesta integração');
      }
      return this.prisma.$transaction(async tx => {
        const active = await tx.user.findUnique({ where: { id: existing.userId } });
        if (!active?.isActive || active.isPurged) throw new BadRequestException('Comerciante exige conta ativa previamente cadastrada');
        const cnpjOwner = await tx.user.findUnique({ where: { cnpj }, select: { id: true } });
        if (cnpjOwner && cnpjOwner.id !== existing.userId) throw new ConflictException('CNPJ já pertence a outra conta');
        await tx.user.update({
          where: { id: existing.userId },
          data: { cnpj, isCompany: true, name: legalName },
        });
        return tx.integrationMerchant.update({
          where: { id: existing.id },
          data: { cnpj, legalName },
          select: { cnpj: true, externalMerchantId: true, id: true, integrationKey: true, legalName: true },
        });
      });
    }

    const clash = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_cnpj: { integrationKey, cnpj } },
    });
    if (clash) throw new ConflictException('CNPJ já vinculado a outro merchant nesta integração');

    return this.prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { cnpj } });
      if (!user?.isActive || user.isPurged) throw new BadRequestException('Comerciante exige conta ativa previamente cadastrada');
      return tx.integrationMerchant.create({
        data: { cnpj, externalMerchantId, integrationKey, legalName, userId: user.id },
        select: { cnpj: true, externalMerchantId: true, id: true, integrationKey: true, legalName: true },
      });
    });

  }
}
