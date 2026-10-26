import { describe, it, expect, mock } from 'bun:test';
import { PlatformEventsService } from './platform-events.service';

describe('PlatformEventsService', () => {
  it('isolates platforms and preserves legacy payload and stream kind', () => {
    const bus = new PlatformEventsService();
    const received: unknown[] = [];
    const subscription = bus.stream('BOSQUE', 'transaction').subscribe((event) => received.push(event));
    bus.emit('ATLAS', 'transaction', { id: 'other' });
    bus.emit('BOSQUE', 'withdrawal', { id: 'withdrawal' });
    bus.emit('BOSQUE', 'transaction', { id: 'own' });
    expect(received).toEqual([{ id: 'own' }]);
    subscription.unsubscribe();
  });
});
