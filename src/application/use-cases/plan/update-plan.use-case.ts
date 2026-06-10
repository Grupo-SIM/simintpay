import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { CreatePlanDto, PlanTipoDto } from '../../dtos/plan/create-plan.dto';

function mapTipo(tipo: PlanTipoDto): PlanType {
  switch (tipo) {
    case 'MENSAL':
      return PlanType.MONTHLY;
    case 'TRIMESTRAL':
      return PlanType.TRIMESTRAL;
    case 'SEMESTRAL':
      return PlanType.SEMESTRAL;
    case 'ANUAL':
    default:
      return PlanType.ANUAL;
  }
}

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

@Injectable()
export class UpdatePlanUseCase {
  constructor(
    @Inject(PLAN_REPOSITORY) private readonly plans: IPlanRepository,
  ) {}

  async execute(input: {
    userId: string;
    role: string;
    id: string;
    dto: Partial<CreatePlanDto> & { isActive?: boolean };
  }): Promise<{ data: unknown }> {
    const existing = input.role === 'ADMIN'
      ? await this.plans.findById(input.id)
      : await this.plans.findByIdForUser({ id: input.id, userId: input.userId });

    if (!existing) {
      throw new NotFoundException('Plano não encontrado');
    }

    if (input.role !== 'ADMIN' && existing.userId !== input.userId) {
      throw new UnauthorizedException('Sem permissão para editar este plano');
    }

    const updated = await this.plans.update(input.id, {
      name: input.dto.nome ?? existing.name,
      description: input.dto.descricao ?? existing.description,
      price: input.dto.preco ?? Number(existing.price),
      type: input.dto.tipo ? mapTipo(input.dto.tipo) : existing.type,
      webhookUrl: input.dto.webhookUrl ?? existing.webhookUrl,
      redirectUrl: input.dto.redirectUrl ?? existing.redirectUrl,
      ...(input.dto.isActive !== undefined && { isActive: input.dto.isActive }),
      ...(input.dto.code !== undefined && { code: input.dto.code }),
      ...(input.dto.emailBody !== undefined && { emailBody: input.dto.emailBody }),
      ...(input.dto.plataformas !== undefined && { plataformas: input.dto.plataformas }),
    });

    return {
      data: {
        id: updated.id,
        nome: updated.name,
        descricao: updated.description ?? null,
        preco: Number(updated.price),
        tipo: mapPlanTypeToPt(updated.type),
        ativo: updated.isActive,
        redirectUrl: updated.redirectUrl ?? null,
        webhookUrl: updated.webhookUrl ?? null,
        criadoEm: updated.createdAt.toISOString(),
      },
    };
  }
}
