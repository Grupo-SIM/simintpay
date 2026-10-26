import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { CreateClienteDto } from '../../dtos/cliente/create-cliente.dto';

@Injectable()
export class CreateClienteUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string; body: CreateClienteDto }) {
    const email = input.body.email.trim().toLowerCase();
    const document = input.body.document ? input.body.document.replace(/\D/g, '') : '';

    // Se já existe para este usuário com mesmo email, retorna o existente
    const existing = await this.prisma.customer.findFirst({
      where: { userId: input.userId, email },
    });
    if (existing) return existing;

    const customer = await this.prisma.customer.create({
      data: {
        userId: input.userId,
        name: input.body.name,
        email,
        document,
        documentType: input.body.documentType ?? 'CPF',
        phone: input.body.phone ?? null,
      },
    });

    return customer;
  }
}
