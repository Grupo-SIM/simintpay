import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class RenovadaEventsService {
  private readonly transactionEventSubject = new Subject<any>();
  private readonly withdrawalEventSubject = new Subject<any>();

  /**
   * Pushes a new transaction event to all subscribers (SSE)
   */
  emitTransaction(data: any) {
    this.transactionEventSubject.next(data);
  }

  /**
   * Pushes saque/withdrawal updates (criação, aprovação, rejeição).
   */
  emitWithdrawal(data: any) {
    this.withdrawalEventSubject.next(data);
  }

  /**
   * Observable stream for SSE
   */
  getTransactionStream() {
    return this.transactionEventSubject.asObservable();
  }

  getWithdrawalStream() {
    return this.withdrawalEventSubject.asObservable();
  }
}
