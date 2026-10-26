import { Injectable } from '@nestjs/common';
import { filter, map, Subject } from 'rxjs';

type PlatformEvent = { tag: string; type: 'transaction' | 'withdrawal'; data: any };

@Injectable()
export class PlatformEventsService {
  private readonly events = new Subject<PlatformEvent>();

  emit(tag: string, type: PlatformEvent['type'], data: any) {
    this.events.next({ tag, type, data });
  }

  stream(tag: string, type?: PlatformEvent['type']) {
    return this.events.pipe(filter((event) => event.tag === tag && (!type || event.type === type)), map((event) => event.data));
  }

  messages(tag: string) {
    return this.events.pipe(filter((event) => event.tag === tag), map((event) => ({ type: event.type, data: event.data })));
  }
}
