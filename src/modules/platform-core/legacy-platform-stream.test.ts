import { expect, test } from 'bun:test';
import { firstValueFrom, NEVER, take, filter } from 'rxjs';
import { TestScheduler } from 'rxjs/testing';
import { legacyPlatformStream } from './legacy-platform-stream';
import { PlatformEventsService } from './platform-events.service';
import { AtlasRealtimeController } from '../atlas/controllers/atlas-realtime.controller';
import { BosqueRealtimeController } from '../bosque/controllers/bosque-realtime.controller';
import { RenovadaRealtimeController } from '../renovada/controllers/renovada-realtime.controller';
import { RevalidaRealtimeController } from '../revalida/controllers/revalida-realtime.controller';
import { AtlasEventsService } from '../atlas/events/atlas-events.service';
import { BosqueEventsService } from '../bosque/events/bosque-events.service';
import { RenovadaEventsService } from '../renovada/events/renovada-events.service';
import { RevalidaEventsService } from '../revalida/events/revalida-events.service';
const families = [ ['ATLAS', AtlasRealtimeController, AtlasEventsService], ['BOSQUE', BosqueRealtimeController, BosqueEventsService], ['RENOVADA', RenovadaRealtimeController, RenovadaEventsService], ['REVALIDA', RevalidaRealtimeController, RevalidaEventsService] ] as const;
for (const [tag, Controller, Events] of families) {
  for (const kind of ['transaction', 'withdrawal'] as const) {
    test(`${tag} ${kind} alias preserves heartbeat, headers, names, ids and bus isolation`, async () => {
      const bus = new PlatformEventsService();
      const controller = new Controller(new Events(bus) as any);
      const headers: Record<string, unknown> = {};
      const response = { setHeader: (key: string, value: unknown) => { headers[key] = value; } } as any;
      const stream = kind === 'transaction' ? controller.sseTransactions(response) : controller.sseWithdrawals(response);
      expect(await firstValueFrom(stream)).toEqual({ type: 'heartbeat', data: { type: 'heartbeat' } });
      expect(headers).toEqual({ 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive' });
      const received = firstValueFrom(stream.pipe(filter(event => event.type !== 'heartbeat')));
      bus.emit('FOREIGN', kind, { id: 'foreign' });
      const data = { id: 'row', withdrawId: 'withdraw-id', amount: 12.34 };
      bus.emit(tag, kind, data);
      expect(await received).toEqual({ type: kind === 'transaction' ? 'new-transaction' : 'new-withdrawal', id: kind === 'withdrawal' && ['BOSQUE', 'RENOVADA'].includes(tag) ? 'withdraw-id' : 'row', data });
    });
  }
}
test('heartbeat repeats exactly every twenty seconds on shared scheduler', () => {
  const scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
  scheduler.run(({ expectObservable }) => {
    const stream = legacyPlatformStream(NEVER, 'transaction', { setHeader: () => {} } as any, false, scheduler);
    expectObservable(stream.pipe(take(3))).toBe('a 19999ms a 19999ms (a|)', { a: { type: 'heartbeat', data: { type: 'heartbeat' } } });
  });
});
