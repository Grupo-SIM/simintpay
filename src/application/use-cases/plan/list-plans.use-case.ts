import { Inject, Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';

function mapPlanTypeToPt(
  tipo: PlanType,
): 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' {
  switch (tipo) {
    case PlanType.MONTHLY:
      return 'MENSAL';
    case PlanType.TRIMESTRAL:
      return 'TRIMESTRAL';
    case PlanType.SEMESTRAL:
      return 'SEMESTRAL';
    case PlanType.ANUAL:
    default:
      return 'ANUAL';
  }
}

function formatCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const digits = cpf.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

@Injectable()
export class ListPlansUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: { userId: string; role: string }): Promise<{ data: unknown }> {
    let items: any[];

    if (input.role === 'ADMIN') {
      items = await this.prisma.plan.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { cpf: true } } },
      });
    } else {
      items = await this.prisma.plan.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { cpf: true } } },
      });
    }

    return {
      data: items.map((p) => ({
        id: p.id,
        nome: p.name,
        descricao: p.description ?? null,
        preco: Number(p.price),
        tipo: mapPlanTypeToPt(p.type),
        ativo: p.isActive,
        webhookUrl: p.webhookUrl ?? null,
        redirectUrl: p.redirectUrl ?? null,
        criadoEm: p.createdAt.toISOString(),
        cpfDono: formatCpf(p.user?.cpf),
      })),
    };
  }
}
