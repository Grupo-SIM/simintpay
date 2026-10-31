import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import {
  coproductionInfo,
  sharedProductIds,
} from '../../../modules/coproduction/coproduction-view';
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

    if (input.role === 'ADMIN' && !input.query.onlyMine) {
      [total, items] = await this.prisma.$transaction([
        this.prisma.paymentLink.count(),
        this.prisma.paymentLink.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            user: {
              select: {
                cpf: true,
                name: true,
                email: true,
                clientStatus: true,
              },
            },
          },
        }),
      ]);
    } else {
      const shared = await sharedProductIds(
        this.prisma,
        'links-pagamento',
        input.userId,
      );
      const where = shared.length
        ? { OR: [{ userId: input.userId }, { id: { in: shared } }] }
        : { userId: input.userId };
      [total, items] = await this.prisma.$transaction([
        this.prisma.paymentLink.count({ where }),
        this.prisma.paymentLink.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: {
            user: {
              select: {
                cpf: true,
                name: true,
                email: true,
                clientStatus: true,
              },
            },
          },
        }),
      ]);
    }

    const coproducao = await coproductionInfo(
      this.prisma,
      'links-pagamento',
      input.userId,
      items,
    );

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
        // Quem criou o link (cliente ou master) — para a coluna "Criado por".
        donoNome: l.user?.name ?? null,
        donoEmail: l.user?.email ?? null,
        // Link de cliente SimintPay → exibe SIMINTPAY (links antigos podem ter GLOBAL/vazio gravado).
        coproducao: coproducao.get(l.id) ?? null,
        plataformas:
          l.user?.clientStatus != null ? ['SIMINTPAY'] : (l.plataformas ?? []),
      })),
      page,
      pageSize,
      total,
    };
  }
}
