import { LegacyInternalAuthGuard } from '../modules/platform-core/legacy-internal-auth.guard';
import { PlatformFinanceService } from '../modules/unified-platform/finance/platform-finance.service';
import { InternalPagatgFinanceService } from '../modules/unified-platform/finance/legacy-pagatg-finance.service';
import { InternalAreaflixFinanceService } from '../modules/unified-platform/finance/legacy-areaflix-finance.service';
import { InternalRenovadaFinanceService } from '../modules/unified-platform/finance/legacy-renovada-finance.service';
import { InternalBosqueFinanceService } from '../modules/unified-platform/finance/legacy-bosque-finance.service';
import { InternalAtlasFinanceService } from '../modules/unified-platform/finance/legacy-atlas-finance.service';
import { Module } from '@nestjs/common';
import { CheckoutController } from './controllers/checkout.controller';
import { InternalPagatgFinanceController } from './controllers/internal-pagatg-finance.controller';
import { InternalRenovadaFinanceController } from './controllers/internal-renovada-finance.controller';
import { InternalBosqueFinanceController } from './controllers/internal-bosque-finance.controller';
import { InternalAtlasFinanceController } from './controllers/internal-atlas-finance.controller';
import { InternalAreaflixFinanceController } from './controllers/internal-areaflix-finance.controller';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { VoucherModule } from './voucher.module';
import { CheckoutEventsService } from '../application/services/checkout-events.service';

@Module({
  imports: [ApiDomModule, VoucherModule],
  controllers: [
    CheckoutController,
    InternalPagatgFinanceController,
    InternalRenovadaFinanceController,
    InternalBosqueFinanceController,
    InternalAtlasFinanceController,
    InternalAreaflixFinanceController,
  ],
  providers: [
    LegacyInternalAuthGuard,
    CheckoutEventsService,
    PlatformFinanceService,
    InternalAtlasFinanceService,
    InternalBosqueFinanceService,
    InternalRenovadaFinanceService,
    InternalAreaflixFinanceService,
    InternalPagatgFinanceService,
  ],
  exports: [
    CheckoutEventsService,
    PlatformFinanceService,
    InternalAtlasFinanceService,
    InternalBosqueFinanceService,
    InternalRenovadaFinanceService,
    InternalAreaflixFinanceService,
    InternalPagatgFinanceService,
  ],
})
export class CheckoutModule {}
