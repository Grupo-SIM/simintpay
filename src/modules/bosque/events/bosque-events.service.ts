import { Injectable } from '@nestjs/common';
import { PlatformEventsService } from '../../platform-core/platform-events.service';

/** Legacy facade preserves original streams and event payloads. */
@Injectable()
export class BosqueEventsService {
  constructor(private readonly events: PlatformEventsService) {}

  emitTransaction(data: unknown) { this.events.emit('BOSQUE', 'transaction', data); }
  emitWithdrawal(data: unknown) { this.events.emit('BOSQUE', 'withdrawal', data); }
  getTransactionStream() { return this.events.stream('BOSQUE', 'transaction'); }
  getWithdrawalStream() { return this.events.stream('BOSQUE', 'withdrawal'); }
}
