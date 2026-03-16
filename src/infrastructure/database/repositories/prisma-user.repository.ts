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

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        isActive: data.isActive,
        domUserId: data.domUserId ?? undefined,
        domToken: data.domToken ?? undefined,
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
}
