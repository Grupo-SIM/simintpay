import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LEAD_REPOSITORY, type ILeadRepository } from '../../../core/repositories/lead.repository.interface';

@Injectable()
export class DeleteLeadsUseCase {
  constructor(@Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository) {}

  async execute(input: { leadIds: string[] }): Promise<{ deleted: number }> {
    const leadIds = [...new Set(input.leadIds.filter(Boolean))];
    if (leadIds.length === 0) {
      throw new BadRequestException('Selecione ao menos uma solicitação');
    }

    const leads = await this.leads.findByIds(leadIds);
    if (leads.length !== leadIds.length) {
      throw new NotFoundException('Uma ou mais solicitações não foram encontradas');
    }
    if (leads.some((lead) => lead.status === 'PENDING')) {
      throw new BadRequestException('Solicitações pendentes não podem ser excluídas');
    }

    // O repositório também filtra por status: se algum registro virar PENDING
    // entre a validação acima e o DELETE, ele não será removido.
    const deleted = await this.leads.deleteMany(leadIds);
    if (deleted !== leadIds.length) {
      throw new ConflictException('Uma ou mais solicitações mudaram de status. Atualize a lista e tente novamente');
    }

    return { deleted };
  }
}
