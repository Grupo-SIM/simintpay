import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class ListClientesUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string; role?: string }) {
    const isAdmin = input.role === 'ADMIN' || input.role === 'MASTER';

    const customers = await this.prisma.customer.findMany({
      where: isAdmin ? undefined : { userId: input.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        name: true,
        email: true,
        document: true,
        documentType: true,
        phone: true,
        domCustomerId: true,
        createdAt: true,
      },
    });

    return customers;
  }
}
