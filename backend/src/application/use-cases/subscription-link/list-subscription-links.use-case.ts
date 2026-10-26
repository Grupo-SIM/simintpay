import { Inject, Injectable } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { SUBSCRIPTION_LINK_REPOSITORY } from '../../../core/repositories/subscription-link.repository.interface';
import type { ISubscriptionLinkRepository } from '../../../core/repositories/subscription-link.repository.interface';

function mapFreq(t: PlanType): string {
  const m: Record<PlanType, string> = {
    WEEKLY: 'SEMANAL', MONTHLY: 'MENSAL', TRIMESTRAL: 'TRIMESTRAL', SEMESTRAL: 'SEMESTRAL', ANUAL: 'ANUAL',
  };
  return m[t] ?? 'MENSAL';
}

@Injectable()
export class ListSubscriptionLinksUseCase {
  constructor(
    @Inject(SUBSCRIPTION_LINK_REPOSITORY) private readonly repo: ISubscriptionLinkRepository,
  ) {}

  async execute(input: { userId: string; role?: string; onlyMine?: boolean; page?: number; pageSize?: number }) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const result = input.role === 'ADMIN' && !input.onlyMine
      ? await this.repo.findAll({ page, pageSize })
      : await this.repo.findManyByUserId({ userId: input.userId, page, pageSize });

    return {
      data: result.items.map((l) => {
        // Link de cliente SimintPay sem plataforma própria selecionada → exibe SIMINTPAY
        // (o master aplica a taxa via CLIENT:<email>). Quando o cliente escolheu uma
        // plataforma própria explicitamente, respeita o valor gravado em vez de sobrescrever.
        const plataformasGravadas = (l as any).plataformas ?? [];
        const isCliente = (l as any).user?.clientStatus != null && plataformasGravadas.length === 0;
        return {
          id: l.id,
          codigo: l.code,
          nome: l.name,
          descricao: l.description ?? null,
          valor: Number(l.amount),
          frequencia: mapFreq(l.frequencyType),
          isStandalone: l.isStandalone,
          platformFee: l.platformFee,
          ativo: l.isActive,
          usos: l.currentUses,
          maxUsos: l.maxUses ?? null,
          criadoEm: l.createdAt.toISOString(),
          // Quem criou o link (cliente ou master) — para a coluna "Criado por".
          donoNome: (l as any).user?.name ?? null,
          donoEmail: (l as any).user?.email ?? null,
          plataformas: isCliente ? ['SIMINTPAY'] : plataformasGravadas,
        };
      }),
      total: result.total,
      page,
      pageSize,
    };
  }
}
