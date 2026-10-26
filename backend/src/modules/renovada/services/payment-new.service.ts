import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { LegacyPlatformPaymentCore } from '../../unified-platform/payments/legacy-platform-payment.core';
import { RenovadaConfig } from '../renovada.config';

/** Compatibility name retained for Renovada Payments API. */
@Injectable()
export class PaymentNewService extends LegacyPlatformPaymentCore {
  constructor(prisma: PrismaService) { super(prisma, undefined, 'RENOVADA', RenovadaConfig); }
}
