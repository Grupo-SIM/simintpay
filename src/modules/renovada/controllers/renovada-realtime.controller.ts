import { Controller, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { RenovadaEventsService } from '../events/renovada-events.service';
import { legacyPlatformStream } from '../../platform-core/legacy-platform-stream';

@Controller('admin/renovada/real-time')
export class RenovadaRealtimeController {
  constructor(private readonly events: RenovadaEventsService) {}

  @Sse('transactions')
  sseTransactions(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getTransactionStream(), 'transaction', res);
  }

  @Sse('withdrawals')
  sseWithdrawals(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getWithdrawalStream(), 'withdrawal', res, true);
  }
}
