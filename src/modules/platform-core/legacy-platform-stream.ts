import type { MessageEvent } from '@nestjs/common';
import type { Response } from 'express';
import { merge, timer, type Observable, type SchedulerLike } from 'rxjs';
import { map } from 'rxjs/operators';

/** Legacy names/headers are projections of the shared platform event bus. */
export function legacyPlatformStream(stream: Observable<any>, kind: 'transaction' | 'withdrawal', response: Response, withdrawalIds = false, scheduler?: SchedulerLike): Observable<MessageEvent> {
  response.setHeader('X-Accel-Buffering', 'no');
  response.setHeader('Cache-Control', 'no-cache, no-store');
  response.setHeader('Connection', 'keep-alive');
  return merge(
    timer(0, 20000, scheduler).pipe(map(() => ({ data: { type: 'heartbeat' }, type: 'heartbeat' }))),
    stream.pipe(map(data => ({ data, type: kind === 'transaction' ? 'new-transaction' : 'new-withdrawal',
      id: kind === 'transaction' ? data.id : withdrawalIds ? data?.withdrawId ?? data?.id ?? 'withdraw' : data?.id ?? 'withdrawal' }))),
  );
}
