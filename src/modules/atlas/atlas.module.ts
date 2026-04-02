import { Module } from '@nestjs/common';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AtlasEventsService } from './events/atlas-events.service';
import { AtlasSyncService } from './services/atlas-sync.service';
import { AtlasDashboardService } from './services/atlas-dashboard.service';
import { AtlasPaymentService } from './services/atlas-payment.service';
import { AtlasPaymentController } from './controllers/atlas-payment.controller';
import { AtlasDashboardController } from './controllers/atlas-dashboard.controller';
import { AtlasRealtimeController } from './controllers/atlas-realtime.controller';

@Module({
  imports: [ApiDomModule, PrismaModule],
  controllers: [
    AtlasPaymentController,
    AtlasDashboardController,
    AtlasRealtimeController,
  ],
  providers: [
    AtlasEventsService,
    AtlasSyncService,
    AtlasDashboardService,
    AtlasPaymentService,
  ],
  exports: [
    AtlasEventsService,
    AtlasSyncService,
    AtlasPaymentService,
  ],
})
export class AtlasModule {}
