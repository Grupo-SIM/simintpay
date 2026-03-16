import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { LeadController } from './controllers/lead.controller';
import { CreateLeadUseCase } from '../application/use-cases/lead/create-lead.use-case';

@Module({
  imports: [ApiDomModule],
  controllers: [LeadController],
  providers: [CreateLeadUseCase],
})
export class LeadModule {}
