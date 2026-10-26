import { Injectable } from '@nestjs/common';
import { PlatformEventsService } from '../../platform-core/platform-events.service';

/** Legacy facade preserves original streams and event payloads. */
@Injectable()
export class AtlasEventsService {
  constructor(private readonly events: PlatformEventsService) {}

  emitTransaction(data: unknown) { this.events.emit('ATLAS', 'transaction', data); }
  emitWithdrawal(data: unknown) { this.events.emit('ATLAS', 'withdrawal', data); }
  getTransactionStream() { return this.events.stream('ATLAS', 'transaction'); }
  getWithdrawalStream() { return this.events.stream('ATLAS', 'withdrawal'); }
}
