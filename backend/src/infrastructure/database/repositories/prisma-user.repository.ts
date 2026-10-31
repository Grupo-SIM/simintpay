import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import {
  CreateUserData,
  IUserRepository,
} from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<any | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        platform: true,
        ownedPlatforms: {
          select: { id: true, tag: true, name: true, isActive: true },
        },
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async hasIdentityConflict(
    email: string,
    cpf: string,
    cnpj: string,
  ): Promise<boolean> {
    const [result] = await this.prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "User"
        WHERE lower(trim("email")) = ${email}
          OR regexp_replace("cpf", '[^0-9]', '', 'g') IN (${cpf}, ${cnpj})
          OR regexp_replace("cnpj", '[^0-9]', '', 'g') IN (${cpf}, ${cnpj})
      ) AS "exists"
    `;
    return result.exists;
  }

  async create(data: CreateUserData): Promise<User> {
    return (this.prisma.user as any).create({
      data: {
        wallet: { create: { balance: 0, lockedBalance: 0 } },
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        isActive: data.isActive,
        domUserId: data.domUserId ?? undefined,
        domToken: data.domToken ?? undefined,
        cpf: data.cpf ?? undefined,
        cnpj: data.cnpj ?? undefined,
        platformId: data.platformId ?? undefined,
        clientStatus: data.clientStatus ?? undefined,
        clientApprovedAt: data.clientApprovedAt ?? undefined,
      },
    });
  }

  async updateProfile(
    id: string,
    data: { name?: string; email?: string },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
      },
    });
  }

  async updateDomData(
    id: string,
    data: { domUserId?: string | null; domToken?: string | null },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: {
        domUserId: data.domUserId ?? undefined,
        domToken: data.domToken ?? undefined,
      },
    });
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async findByAffiliateCode(code: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { affiliateCode: code } });
  }

  async setReferredBy(
    userId: string,
    referredByUserId: string | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { referredByUserId },
    });
  }
}
