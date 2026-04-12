import { Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

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

function extractPlatformFromName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('pagatg') || n.includes('paga tg')) return 'PagaTG';
  if (n.includes('areaflix') || n.includes('área flix') || n.includes('area flix')) return 'Areaflix';
  if (n.includes('ebook') || n.includes('e-book')) return 'Ebook';
  if (n.includes('renovada')) return 'Renovada';
  if (n.includes('bosque') || n.includes('ibb')) return 'Bosque';
  if (n.includes('marketing raiz') || n.includes('marketing-raiz')) return 'Marketing Raiz';
  if (n.includes('revalida') || n.includes('révali')) return 'Revalida';
  if (n.includes('comunidade') || n.includes('community')) return 'Comunidade';
  return null;
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
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string; role: string }): Promise<{ data: unknown }> {
    let items: any[];

    const userSelect = { select: { cpf: true, name: true, email: true } };

    if (input.role === 'ADMIN') {
      items = await this.prisma.plan.findMany({
        orderBy: { createdAt: 'desc' },
        include: { user: userSelect },
      });
    } else {
      items = await this.prisma.plan.findMany({
        where: { userId: input.userId },
        orderBy: { createdAt: 'desc' },
        include: { user: userSelect },
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
        donoNome: p.user?.name ?? null,
        donoEmail: p.user?.email ?? null,
        plataforma: extractPlatformFromName(p.name),
      })),
    };
  }
}
