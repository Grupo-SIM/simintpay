import { Controller, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { RevalidaEventsService } from '../events/revalida-events.service';
import { legacyPlatformStream } from '../../platform-core/legacy-platform-stream';

@Controller('admin/revalida/real-time')
export class RevalidaRealtimeController {
  constructor(private readonly events: RevalidaEventsService) {}

  @Sse('transactions')
  sseTransactions(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getTransactionStream(), 'transaction', res);
  }

  @Sse('withdrawals')
  sseWithdrawals(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getWithdrawalStream(), 'withdrawal', res, false);
  }
}
