import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service';
import { InternalBetaiController } from './controllers/internal-betai.controller';
import { BetaiAdminController } from './controllers/betai-admin.controller';
import { SubscriptionLinkModule } from './subscription-link.module';

@Module({
  imports: [ApiDomModule, SubscriptionLinkModule],
  controllers: [InternalBetaiController, BetaiAdminController],
  providers: [PrismaService],
})
export class InternalBetaiModule {}
