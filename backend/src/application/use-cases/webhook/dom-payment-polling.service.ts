import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ReconcilePendingTransactionsUseCase } from './reconcile-pending-transactions.use-case';

/** Explicit lifecycle keeps polling startup and shutdown observable. */
@Injectable()
export class DomPaymentPollingService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DomPaymentPollingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private draftTimer?: ReturnType<typeof setInterval>;
  private syncTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly reconcile: ReconcilePendingTransactionsUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (this.timer) return;
    this.logger.log(
      '[Reconcile][poll] registered: intervalMs=5000 windowMinutes=30',
    );
    this.timer = setInterval(
      () => void this.reconcile.pollRecentPayments(),
      5_000,
    );
    this.timer.unref();
    void this.reconcile.pollRecentPayments();
    // DRAFTs órfãos (cobrança criada na DOM sem a resposta ter chegado) são recuperados a cada 60s.
    this.draftTimer = setInterval(
      () => void this.reconcile.recoverOrphanDrafts(),
      60_000,
    );
    this.draftTimer.unref();
    // Sincronização completa com a DOM a cada 5 min, cobrindo o que o polling de 30 min já não alcança.
    this.syncTimer = setInterval(
      () => void this.reconcile.syncWithAcquirer(),
      300_000,
    );
    this.syncTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.draftTimer) clearInterval(this.draftTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.timer = undefined;
    this.draftTimer = undefined;
    this.syncTimer = undefined;
    this.logger.log('[Reconcile][poll] stopped');
  }
}
