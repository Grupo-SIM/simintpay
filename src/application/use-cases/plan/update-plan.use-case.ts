import { assertExplicitPlatform, platformGatewayToken } from '../../helpers/explicit-platform.helper';
import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PlanType } from '@prisma/client';
import { PLAN_REPOSITORY } from '../../../core/repositories/plan.repository.interface';
import type { IPlanRepository } from '../../../core/repositories/plan.repository.interface';
import type { CreatePlanDto, PlanTipoDto } from '../../dtos/plan/create-plan.dto';

// Frequências suportadas: apenas Semanal (WEEKLY), Mensal (MONTHLY) e Anual (ANUAL).
function mapTipo(tipo: PlanTipoDto): PlanType {
  switch (tipo) {
    case 'SEMANAL':
      return PlanType.WEEKLY;
    case 'ANUAL':
      return PlanType.ANUAL;
    case 'MENSAL':
    default:
      return PlanType.MONTHLY;
  }
}

function mapPlanTypeToPt(tipo: PlanType): 'SEMANAL' | 'MENSAL' | 'ANUAL' {
  switch (tipo) {
    case PlanType.WEEKLY:
      return 'SEMANAL';
    case PlanType.ANUAL:
      return 'ANUAL';
    default:
      // MONTHLY (+ legado TRIMESTRAL/SEMESTRAL, que não são mais oferecidos)
      return 'MENSAL';
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

    const selectedTag = assertExplicitPlatform({ id: input.userId, role: input.role }, input.dto.plataformas ?? existing.plataformas, true);
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
      ...(input.dto.plataformas !== undefined && { plataformas: selectedTag ? [selectedTag] : [] }),
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
