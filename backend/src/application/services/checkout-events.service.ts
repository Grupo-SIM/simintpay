import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface CheckoutStatusEvent {
  domPaymentId: string;
  status: 'COMPLETED' | 'FAILED' | 'EXPIRED';
}

@Injectable()
export class CheckoutEventsService {
  private readonly subject = new Subject<CheckoutStatusEvent>();

  emit(event: CheckoutStatusEvent) {
    this.subject.next(event);
  }

  getStream(domPaymentId: string) {
    return this.subject.asObservable().pipe(
      filter((e) => e.domPaymentId === domPaymentId),
    );
  }
}
