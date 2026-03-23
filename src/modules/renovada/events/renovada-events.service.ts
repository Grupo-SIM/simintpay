import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class RenovadaEventsService {
  private readonly transactionEventSubject = new Subject<any>();

  /**
   * Pushes a new transaction event to all subscribers (SSE)
   */
  emitTransaction(data: any) {
    this.transactionEventSubject.next(data);
  }

  /**
   * Observable stream for SSE
   */
  getTransactionStream() {
    return this.transactionEventSubject.asObservable();
  }
}
