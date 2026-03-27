import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RevalidaEventsService } from '../events/revalida-events.service';

@Controller('admin/revalida/real-time')
export class RevalidaRealtimeController {
  constructor(private readonly events: RevalidaEventsService) {}

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
