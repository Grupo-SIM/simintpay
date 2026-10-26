import { Inject, Injectable } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { LEAD_REPOSITORY } from '../../../core/repositories/lead.repository.interface';
import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';

@Injectable()
export class ListLeadsUseCase {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository,
  ) {}

  async execute(query: {
    page: number;
    pageSize: number;
    status?: LeadStatus;
  }) {
    return this.leads.list(query);
  }
}
