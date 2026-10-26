import { Module } from '@nestjs/common';
import { ApiDomModule } from '../../infrastructure/http/api-dom.module';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { AtlasEventsService } from './events/atlas-events.service';
import { AtlasSyncService } from './services/atlas-sync.service';
import { AtlasDashboardService } from './services/atlas-dashboard.service';
import { AtlasPaymentService } from './services/atlas-payment.service';
import { AtlasMailService } from './services/atlas-mail.service';
import { AtlasPaymentController } from './controllers/atlas-payment.controller';
import { AtlasDashboardController } from './controllers/atlas-dashboard.controller';
import { AtlasRealtimeController } from './controllers/atlas-realtime.controller';
import { AtlasMailController } from './controllers/atlas-mail.controller';

@Module({
  imports: [ApiDomModule, PrismaModule],
  controllers: [
    AtlasPaymentController,
    AtlasDashboardController,
    AtlasRealtimeController,
    AtlasMailController,
  ],
  providers: [
    AtlasEventsService,
    AtlasSyncService,
    AtlasDashboardService,
    AtlasPaymentService,
    AtlasMailService,
  ],
  exports: [
    AtlasEventsService,
    AtlasSyncService,
    AtlasPaymentService,
    AtlasMailService,
  ],
})
export class AtlasModule {}
