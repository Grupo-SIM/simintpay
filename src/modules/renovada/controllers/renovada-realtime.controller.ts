import { Controller, Sse, MessageEvent, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RenovadaEventsService } from '../events/renovada-events.service';

@Controller('admin/renovada/real-time')
export class RenovadaRealtimeController {
  constructor(private readonly events: RenovadaEventsService) {}

  @Sse('transactions')
  sseTransactions(): Observable<MessageEvent> {
    return this.events.getTransactionStream().pipe(
      map((tx) => ({
        data: tx,
        id: tx.id,
        type: 'new-transaction',
      }) as MessageEvent)
    );
  }
}
