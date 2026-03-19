import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LEAD_REPOSITORY } from '../../../core/repositories/lead.repository.interface';
import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';

@Injectable()
export class RejectLeadUseCase {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository,
  ) {}

  async execute(input: { leadId: string; reason?: string }) {
    const lead = await this.leads.findById(input.leadId);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.status !== 'PENDING')
      throw new ConflictException('Lead não está pendente');

    return this.leads.reject(input.leadId, input.reason);
  }
}
