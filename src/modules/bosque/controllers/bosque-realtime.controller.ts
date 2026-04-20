import { Controller, MessageEvent, Res, Sse } from '@nestjs/common';
import { Observable, merge, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Response } from 'express';
import { BosqueEventsService } from '../events/bosque-events.service';

const heartbeat$ = timer(0, 20000).pipe(
  map(() => ({ data: { type: 'heartbeat' }, type: 'heartbeat' }) as MessageEvent),
);

function setNginxSseHeaders(res: Response) {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Connection', 'keep-alive');
}

@Controller('admin/bosque/real-time')
export class BosqueRealtimeController {
  constructor(private readonly events: BosqueEventsService) {}

  @Sse('transactions')
  sseTransactions(@Res({ passthrough: true }) res: Response): Observable<MessageEvent> {
    setNginxSseHeaders(res);
    const stream$ = this.events.getTransactionStream().pipe(
      map((tx) => ({ data: tx, id: tx.id, type: 'new-transaction' }) as MessageEvent),
    );
    return merge(heartbeat$, stream$);
  }

  @Sse('withdrawals')
  sseWithdrawals(@Res({ passthrough: true }) res: Response): Observable<MessageEvent> {
    setNginxSseHeaders(res);
    const stream$ = this.events.getWithdrawalStream().pipe(
      map((w) => ({ data: w, id: w?.withdrawId ?? w?.id ?? 'withdraw', type: 'new-withdrawal' }) as MessageEvent),
    );
    return merge(heartbeat$, stream$);
  }
}
