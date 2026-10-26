import { Module } from '@nestjs/common';
import { LeadController } from './controllers/lead.controller';
import { CreateLeadUseCase } from '../application/use-cases/lead/create-lead.use-case';
import { LEAD_REPOSITORY } from '../core/repositories/lead.repository.interface';
import { PrismaLeadRepository } from '../infrastructure/database/repositories/prisma-lead.repository';

@Module({
  controllers: [LeadController],
  providers: [
    CreateLeadUseCase,
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
  ],
})
export class LeadModule {}
