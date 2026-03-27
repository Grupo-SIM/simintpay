import { Module } from '@nestjs/common';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { RevalidaEventsService } from './events/revalida-events.service';
import { RevalidaSyncService } from './services/revalida-sync.service';
import { RevalidaDashboardService } from './services/revalida-dashboard.service';
import { RevalidaDashboardController } from './controllers/revalida-dashboard.controller';
import { RevalidaRealtimeController } from './controllers/revalida-realtime.controller';

@Module({
  imports: [PrismaModule, ApiDomModule],
  controllers: [RevalidaDashboardController, RevalidaRealtimeController],
  providers: [RevalidaEventsService, RevalidaSyncService, RevalidaDashboardService],
  exports: [RevalidaEventsService, RevalidaSyncService],
})
export class RevalidaModule {}
