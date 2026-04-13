import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { ListPaymentLinksQueryDto } from '../../dtos/payment-link/list-payment-links.query.dto';

function formatCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digits = cpf.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

@Injectable()
export class ListPaymentLinksUseCase {
  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role: string;
    query: ListPaymentLinksQueryDto;
  }): Promise<{
    data: unknown;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const page = input.query.page ?? 1;
    const pageSize = input.query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    let total: number;
    let items: any[];

    if (input.role === 'ADMIN') {
      [total, items] = await this.prisma.$transaction([
        this.prisma.paymentLink.count(),
        this.prisma.paymentLink.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { user: { select: { cpf: true } } },
        }),
      ]);
    } else {
      [total, items] = await this.prisma.$transaction([
        this.prisma.paymentLink.count({ where: { userId: input.userId } }),
        this.prisma.paymentLink.findMany({
          where: { userId: input.userId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { user: { select: { cpf: true } } },
        }),
      ]);
    }

    return {
      data: items.map((l) => ({
        id: l.id,
        codigo: l.code,
        titulo: l.title,
        descricao: l.description ?? null,
        valor: Number(l.amount),
        dataExpiracao: l.expiresAt ? l.expiresAt.toISOString() : null,
        parcelasMax: l.maxInstallments,
        ativo: l.isActive,
        criadoEm: l.createdAt.toISOString(),
        cpfDono: formatCpf(l.user?.cpf),
        plataformas: l.plataformas ?? [],
      })),
      page,
      pageSize,
      total,
    };
  }
}
