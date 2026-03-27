import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { RevalidaEventsService } from './events/revalida-events.service';
import { RevalidaSyncService } from './services/revalida-sync.service';
import { RevalidaDashboardService } from './services/revalida-dashboard.service';
import { RevalidaDashboardController } from './controllers/revalida-dashboard.controller';
import { RevalidaRealtimeController } from './controllers/revalida-realtime.controller';

@Module({
  imports: [PrismaModule, HttpModule],
  controllers: [RevalidaDashboardController, RevalidaRealtimeController],
  providers: [RevalidaEventsService, RevalidaSyncService, RevalidaDashboardService],
  exports: [RevalidaEventsService],
})
export class RevalidaModule { }
