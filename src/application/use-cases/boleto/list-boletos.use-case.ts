import { Inject, Injectable } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { ListBoletosQueryDto } from '../../dtos/boleto/list-boletos.query.dto';

function formatCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digits = cpf.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

@Injectable()
export class ListBoletosUseCase {
  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: {
    userId: string;
    role: string;
    query: ListBoletosQueryDto;
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
        this.prisma.boleto.count(),
        this.prisma.boleto.findMany({
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { user: { select: { cpf: true, name: true, email: true, clientStatus: true } } },
        }),
      ]);
    } else {
      [total, items] = await this.prisma.$transaction([
        this.prisma.boleto.count({ where: { userId: input.userId } }),
        this.prisma.boleto.findMany({
          where: { userId: input.userId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include: { user: { select: { cpf: true, name: true, email: true, clientStatus: true } } },
        }),
      ]);
    }

    return {
      data: items.map((b) => ({
        id: b.id,
        codigo: b.code,
        titulo: b.title,
        descricao: b.description ?? null,
        valor: Number(b.amount),
        vencimentoDias: b.vencimentoDias,
        dataExpiracao: b.expiresAt ? b.expiresAt.toISOString() : null,
        ativo: b.isActive,
        link: b.domLink ?? null,
        criadoEm: b.createdAt.toISOString(),
        cpfDono: formatCpf(b.user?.cpf),
        // Quem criou o boleto (cliente ou master) — para a coluna "Criado por".
        donoNome: b.user?.name ?? null,
        donoEmail: b.user?.email ?? null,
        // Boleto de cliente SimintPay → exibe SIMINTPAY.
        plataformas: b.user?.clientStatus != null ? ['SIMINTPAY'] : (b.plataformas ?? []),
      })),
      page,
      pageSize,
      total,
    };
  }
}
