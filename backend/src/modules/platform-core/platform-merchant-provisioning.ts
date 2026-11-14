import { BadRequestException, ConflictException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { isValidDocument } from '../../application/validators/is-document.validator';

export type MerchantProvisionInput = {
  cnpj: string;
  legalName: string;
  /** Opt-in: create the SimIntPay account (without a usable password) when no account holds the document. */
  email?: string;
  /** Opt-in: link an existing account that has this email and no document yet (legacy self-registered seller). */
  adoptByEmail?: boolean;
};

/** Shared persistence for explicitly provisioned merchant accounts. */
export class PlatformMerchantProvisioning {
  constructor(private readonly prisma: PrismaService) {}
  private cleanCnpj(value: string) {
    const cnpj = String(value ?? '').replace(/\D/g, '');
    if (!isValidDocument(cnpj))
      throw new BadRequestException('CPF ou CNPJ inválido');
    return cnpj;
  }
  private cleanEmail(value: unknown) {
    const email = String(value ?? '')
      .trim()
      .toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('E-mail inválido');
    return email;
  }

  /**
   * Account for a seller whose document is unknown to SimIntPay. Never takes over an account by e-mail unless
   * it carries no document at all (self-registered through the legacy API) and the caller opted in. The
   * password is random and never returned or logged: access is set through POST /auth/forgot-password.
   */
  private async accountFor(
    tx: Prisma.TransactionClient,
    input: MerchantProvisionInput,
    documentData: Record<string, unknown>,
    legalName: string,
  ) {
    if (input.email === undefined || input.email === null || input.email === '')
      return null;
    const email = this.cleanEmail(input.email);
    const sameEmail = await tx.user.findUnique({ where: { email } });
    if (sameEmail) {
      if (!input.adoptByEmail)
        throw new ConflictException('E-mail já pertence a outra conta');
      if (
        sameEmail.isPurged ||
        !sameEmail.isActive ||
        sameEmail.cpf ||
        sameEmail.cnpj ||
        sameEmail.role !== 'USER'
      )
        throw new ConflictException('E-mail já pertence a outra conta');
      if (
        await tx.integrationMerchant.findUnique({
          where: { userId: sameEmail.id },
        })
      )
        throw new ConflictException('E-mail já pertence a outro merchant');
      const user = await tx.user.update({
        where: { id: sameEmail.id },
        data: documentData,
      });
      await tx.wallet.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      });
      return { user, accountCreated: false };
    }
    const user = await tx.user.create({
      data: {
        email,
        name: legalName,
        password: await hash(randomBytes(32).toString('hex'), 10),
        clientStatus: 'APPROVED',
        clientApprovedAt: new Date(),
        isActive: true,
        ...documentData,
        wallet: { create: {} },
      } as Prisma.UserUncheckedCreateInput,
    });
    return { user, accountCreated: true };
  }

  async provision(
    integrationKey: string,
    externalMerchantId: string,
    input: MerchantProvisionInput,
  ) {
    const cnpj = this.cleanCnpj(input.cnpj);
    const documentWhere = cnpj.length === 11 ? { cpf: cnpj } : { cnpj };
    const documentData =
      cnpj.length === 11
        ? { cpf: cnpj, cnpj: null, isCompany: false }
        : { cpf: null, cnpj, isCompany: true };
    const legalName = input.legalName?.trim();
    if (!integrationKey.trim() || !externalMerchantId.trim() || !legalName) {
      throw new BadRequestException(
        'Integração, merchant externo e razão social são obrigatórios',
      );
    }

    const existing = await this.prisma.integrationMerchant.findUnique({
      where: {
        integrationKey_externalMerchantId: {
          integrationKey,
          externalMerchantId,
        },
      },
    });
    if (existing) {
      const clash = await this.prisma.integrationMerchant.findUnique({
        where: { integrationKey_cnpj: { integrationKey, cnpj } },
      });
      if (clash && clash.id !== existing.id) {
        throw new ConflictException(
          'CPF/CNPJ já vinculado a outro merchant nesta integração',
        );
      }
      return this.prisma.$transaction(async (tx) => {
        const active = await tx.user.findUnique({
          where: { id: existing.userId },
        });
        if (!active?.isActive || active.isPurged)
          throw new BadRequestException(
            'Comerciante exige conta ativa previamente cadastrada',
          );
        const cnpjOwner = await tx.user.findUnique({
          where: documentWhere,
          select: { id: true },
        });
        if (cnpjOwner && cnpjOwner.id !== existing.userId)
          throw new ConflictException('CPF/CNPJ já pertence a outra conta');
        await tx.user.update({
          where: { id: existing.userId },
          data: { ...documentData, name: legalName },
        });
        return tx.integrationMerchant
          .update({
            where: { id: existing.id },
            data: { cnpj, legalName },
            select: {
              cnpj: true,
              externalMerchantId: true,
              id: true,
              integrationKey: true,
              legalName: true,
            },
          })
          .then((row) => ({ ...row, accountCreated: false }));
      });
    }

    const clash = await this.prisma.integrationMerchant.findUnique({
      where: { integrationKey_cnpj: { integrationKey, cnpj } },
    });
    if (clash)
      throw new ConflictException(
        'CPF/CNPJ já vinculado a outro merchant nesta integração',
      );

    return this.prisma
      .$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: documentWhere });
        let accountCreated = false;
        if (!user) {
          const account = await this.accountFor(
            tx,
            input,
            documentData,
            legalName,
          );
          if (account) ({ user, accountCreated } = account);
        }
        if (!user?.isActive || user.isPurged)
          throw new BadRequestException(
            'Comerciante exige conta ativa previamente cadastrada',
          );
        const merchant = await tx.integrationMerchant.create({
          data: {
            cnpj,
            externalMerchantId,
            integrationKey,
            legalName,
            userId: user.id,
          },
          select: {
            cnpj: true,
            externalMerchantId: true,
            id: true,
            integrationKey: true,
            legalName: true,
          },
        });
        return { ...merchant, accountCreated };
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException(
            'Conta ou merchant já existente (concorrência); repita a chamada',
          );
        throw error;
      });
  }
}
