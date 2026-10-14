import { Controller, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { BosqueEventsService } from '../events/bosque-events.service';
import { legacyPlatformStream } from '../../platform-core/legacy-platform-stream';

@Controller('admin/bosque/real-time')
export class BosqueRealtimeController {
  constructor(private readonly events: BosqueEventsService) {}

  @Sse('transactions')
  sseTransactions(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getTransactionStream(), 'transaction', res);
  }

  @Sse('withdrawals')
  sseWithdrawals(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getWithdrawalStream(), 'withdrawal', res, true);
  }
}
