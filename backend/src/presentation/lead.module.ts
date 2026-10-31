import { Module } from '@nestjs/common';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { LeadController } from './controllers/lead.controller';
import { CreateLeadUseCase } from '../application/use-cases/lead/create-lead.use-case';
import { LEAD_REPOSITORY } from '../core/repositories/lead.repository.interface';
import { PrismaLeadRepository } from '../infrastructure/database/repositories/prisma-lead.repository';

@Module({
  controllers: [LeadController],
  providers: [
    CreateLeadUseCase,
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class LeadModule {}
