import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { ZeroGrauPaymentService } from './services/zero-grau-payment.service';
import { ZeroGrauPaymentController } from './controllers/zero-grau-payment.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ZeroGrauPaymentController],
  providers: [ZeroGrauPaymentService],
  exports: [ZeroGrauPaymentService],
})
export class ZeroGrauModule {}
