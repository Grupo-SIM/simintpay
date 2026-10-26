import { Injectable } from '@nestjs/common';
import { Session } from '@prisma/client';
import {
  CreateSessionData,
  ISessionRepository,
} from '../../../core/repositories/session.repository.interface';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaSessionRepository implements ISessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByRefreshToken(refreshToken: string): Promise<Session | null> {
    return this.prisma.session.findUnique({ where: { refreshToken } });
  }

  async create(data: CreateSessionData): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: data.userId,
        refreshToken: data.refreshToken,
        userAgent: data.userAgent ?? undefined,
        ipAddress: data.ipAddress ?? undefined,
        expiresAt: data.expiresAt,
      },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.session.delete({ where: { id } });
  }

  async deleteByRefreshToken(refreshToken: string): Promise<void> {
    await this.prisma.session.delete({ where: { refreshToken } });
  }
}
