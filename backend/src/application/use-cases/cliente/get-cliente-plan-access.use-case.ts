import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class GetClientePlanAccessUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async executeByCustomerId(input: { userId: string; customerId: string }) {
    const access = await this.prisma.customerPlanAccess.findFirst({
      where: { userId: input.userId, customerId: input.customerId },
      orderBy: { expiresAt: 'desc' },
    });

    return this.buildResponse(access);
  }

  async executeByEmail(input: { userId: string; email: string }) {
    const customer = await this.prisma.customer.findFirst({
      where: { email: input.email.trim().toLowerCase() },
    });

    if (!customer) return this.buildResponse(null);

    return this.executeByCustomerId({ userId: input.userId, customerId: customer.id });
  }

  private buildResponse(access: { isActive: boolean; expiresAt: Date; totalDaysCredited: number } | null) {
    if (!access) {
      return { isActive: false, expiresAt: null, remainingDays: 0, totalDaysCredited: 0 };
    }

    const now = Date.now();
    const expiresAtMs = new Date(access.expiresAt).getTime();
    const remainingMs = Math.max(expiresAtMs - now, 0);
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

    return {
      isActive: access.isActive && expiresAtMs > now,
      expiresAt: access.expiresAt,
      remainingDays,
      totalDaysCredited: access.totalDaysCredited,
    };
  }
}
