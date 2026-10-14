import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { ReconcilePendingTransactionsUseCase } from './reconcile-pending-transactions.use-case';

/** Explicit lifecycle keeps polling startup and shutdown observable. */
@Injectable()
export class DomPaymentPollingService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DomPaymentPollingService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly reconcile: ReconcilePendingTransactionsUseCase) {}

  onApplicationBootstrap(): void {
    if (this.timer) return;
    this.logger.log('[Reconcile][poll] registered: intervalMs=5000 windowMinutes=30');
    this.timer = setInterval(() => void this.reconcile.pollRecentPayments(), 5_000);
    this.timer.unref();
    void this.reconcile.pollRecentPayments();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.logger.log('[Reconcile][poll] stopped');
  }
}
