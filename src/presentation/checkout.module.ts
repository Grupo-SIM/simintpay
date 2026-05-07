import { Module } from '@nestjs/common';
import { CheckoutController } from './controllers/checkout.controller';
import { InternalEbookFinanceController } from './controllers/internal-ebook-finance.controller';
import { InternalPagatgFinanceController } from './controllers/internal-pagatg-finance.controller';
import { InternalRenovadaFinanceController } from './controllers/internal-renovada-finance.controller';
import { InternalBosqueFinanceController } from './controllers/internal-bosque-finance.controller';
import { InternalAtlasFinanceController } from './controllers/internal-atlas-finance.controller';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { VoucherModule } from './voucher.module';
import { CheckoutEventsService } from '../application/services/checkout-events.service';

@Module({
  imports: [ApiDomModule, VoucherModule],
  controllers: [
    CheckoutController,
    InternalEbookFinanceController,
    InternalPagatgFinanceController,
    InternalRenovadaFinanceController,
    InternalBosqueFinanceController,
    InternalAtlasFinanceController,
  ],
  providers: [CheckoutEventsService],
  exports: [CheckoutEventsService],
})
export class CheckoutModule {}
