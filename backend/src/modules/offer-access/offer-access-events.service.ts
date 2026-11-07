import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface OfferAccessStatusEvent {
  transactionId: string;
  status: 'COMPLETED' | 'FAILED' | 'EXPIRED';
}

/** Substitui o `PixPlanEventsService` no SSE `public/pix-plan/status/sse/:transactionId`. */
@Injectable()
export class OfferAccessEventsService {
  private readonly subject = new Subject<OfferAccessStatusEvent>();

  emit(event: OfferAccessStatusEvent) {
    this.subject.next(event);
  }

  getStream(transactionId: string) {
    return this.subject
      .asObservable()
      .pipe(filter((e) => e.transactionId === transactionId));
  }
}
