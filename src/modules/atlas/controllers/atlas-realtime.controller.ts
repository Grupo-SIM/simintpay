import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AtlasEventsService } from '../events/atlas-events.service';

@Controller('admin/atlas/real-time')
export class AtlasRealtimeController {
  constructor(private readonly events: AtlasEventsService) {}

  @Sse('transactions')
  sseTransactions(): Observable<MessageEvent> {
    return this.events.getTransactionStream().pipe(
      map((tx) => ({
        data: tx,
        id: tx.id,
        type: 'new-transaction',
      }) as MessageEvent),
    );
  }

  @Sse('withdrawals')
  sseWithdrawals(): Observable<MessageEvent> {
    return this.events.getWithdrawalStream().pipe(
      map((w) => ({
        data: w,
        id: w?.id ?? 'withdrawal',
        type: 'new-withdrawal',
      }) as MessageEvent),
    );
  }
}
