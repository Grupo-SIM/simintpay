import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { LegacyPlatformPaymentCore } from '../../unified-platform/payments/legacy-platform-payment.core';
import { BosqueConfig } from '../bosque.config';

/** Legacy contract adapter; payment execution belongs to the shared core. */
@Injectable()
export class BosquePaymentService extends LegacyPlatformPaymentCore {
  constructor(prisma: PrismaService) { super(prisma, undefined, 'BOSQUE', BosqueConfig); }
}
