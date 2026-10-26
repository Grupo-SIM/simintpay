import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { LegacyPlatformPaymentCore } from '../../unified-platform/payments/legacy-platform-payment.core';
import { ZeroGrauConfig } from '../zero-grau.config';
import { ReconcilePendingTransactionsUseCase } from '../../../application/use-cases/webhook/reconcile-pending-transactions.use-case';

/** Legacy contract adapter; payment execution belongs to the shared core. */
@Injectable()
export class ZeroGrauPaymentService extends LegacyPlatformPaymentCore {
  constructor(prisma: PrismaService, reconcile: ReconcilePendingTransactionsUseCase) { super(prisma, reconcile, 'ZERO-GRAU', ZeroGrauConfig); }
}
