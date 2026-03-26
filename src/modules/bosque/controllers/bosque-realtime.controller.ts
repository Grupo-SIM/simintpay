import { Controller, Sse, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BosqueEventsService } from '../events/bosque-events.service';

@Controller('admin/bosque/real-time')
export class BosqueRealtimeController {
  constructor(private readonly events: BosqueEventsService) {}

  @Sse('transactions')
  sseTransactions(): Observable<MessageEvent> {
    return this.events.getTransactionStream().pipe(
      map(
        (tx) =>
          ({
            data: tx,
            id: tx.id,
            type: 'new-transaction',
          }) as MessageEvent,
      ),
    );
  }
}
