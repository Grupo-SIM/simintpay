import { Controller, Res, Sse } from '@nestjs/common';
import type { Response } from 'express';
import { AtlasEventsService } from '../events/atlas-events.service';
import { legacyPlatformStream } from '../../platform-core/legacy-platform-stream';

@Controller('admin/atlas/real-time')
export class AtlasRealtimeController {
  constructor(private readonly events: AtlasEventsService) {}

  @Sse('transactions')
  sseTransactions(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getTransactionStream(), 'transaction', res);
  }

  @Sse('withdrawals')
  sseWithdrawals(@Res({ passthrough: true }) res: Response) {
    return legacyPlatformStream(this.events.getWithdrawalStream(), 'withdrawal', res, false);
  }
}
