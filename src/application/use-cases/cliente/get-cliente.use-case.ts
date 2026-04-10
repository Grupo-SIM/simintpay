import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class GetClienteUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async executeById(input: { userId: string; role?: string; id: string }) {
    const isAdmin = input.role === 'ADMIN' || input.role === 'MASTER';
    const isServiceCall = !input.userId;

    const customer = await this.prisma.customer.findUnique({
      where: { id: input.id },
    });

    if (!customer) throw new NotFoundException('Cliente não encontrado');
    if (!isServiceCall && !isAdmin && customer.userId !== input.userId) {
      throw new NotFoundException('Cliente não encontrado');
    }

    return customer;
  }

  async executeByEmail(input: { userId: string; role?: string; email: string }) {
    const isAdmin = input.role === 'ADMIN' || input.role === 'MASTER';
    const isServiceCall = !input.userId;

    const customer = await this.prisma.customer.findFirst({
      where: isAdmin || isServiceCall
        ? { email: input.email.trim().toLowerCase() }
        : { email: input.email.trim().toLowerCase(), userId: input.userId },
    });

    if (!customer) throw new NotFoundException('Cliente não encontrado');

    return customer;
  }

  async executeBasicInfo(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, email: true },
    });

    if (!customer) throw new NotFoundException('Cliente não encontrado');

    return customer;
  }
}
