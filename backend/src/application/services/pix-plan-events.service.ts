import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface PixPlanStatusEvent {
  transactionId: string;
  status: 'COMPLETED' | 'FAILED' | 'EXPIRED';
}

@Injectable()
export class PixPlanEventsService {
  private readonly subject = new Subject<PixPlanStatusEvent>();

  emit(event: PixPlanStatusEvent) {
    this.subject.next(event);
  }

  getStream(transactionId: string) {
    return this.subject.asObservable().pipe(
      filter((e) => e.transactionId === transactionId),
    );
  }
}
