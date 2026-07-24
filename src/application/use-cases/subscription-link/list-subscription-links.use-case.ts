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

  async execute(input: { userId: string; role?: string; page?: number; pageSize?: number }) {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const result = input.role === 'ADMIN'
      ? await this.repo.findAll({ page, pageSize })
      : await this.repo.findManyByUserId({ userId: input.userId, page, pageSize });

    return {
      data: result.items.map((l) => {
        // Link de cliente SimintPay → exibe a plataforma SIMINTPAY (independe do valor gravado,
        // que em links antigos pode estar GLOBAL/vazio). O master aplica a taxa via CLIENT:<email>.
        const isCliente = (l as any).user?.clientStatus != null;
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
          plataformas: isCliente ? ['SIMINTPAY'] : ((l as any).plataformas ?? []),
        };
      }),
      total: result.total,
      page,
      pageSize,
    };
  }
}
