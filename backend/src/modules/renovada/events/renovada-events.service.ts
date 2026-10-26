import { Injectable } from '@nestjs/common';
import { PlatformEventsService } from '../../platform-core/platform-events.service';

/** Legacy facade preserves original streams and event payloads. */
@Injectable()
export class RenovadaEventsService {
  constructor(private readonly events: PlatformEventsService) {}

  emitTransaction(data: unknown) { this.events.emit('RENOVADA', 'transaction', data); }
  emitWithdrawal(data: unknown) { this.events.emit('RENOVADA', 'withdrawal', data); }
  getTransactionStream() { return this.events.stream('RENOVADA', 'transaction'); }
  getWithdrawalStream() { return this.events.stream('RENOVADA', 'withdrawal'); }
}
