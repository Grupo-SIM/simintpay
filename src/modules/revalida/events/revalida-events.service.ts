import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class RevalidaEventsService {
  private readonly transactionEventSubject = new Subject<any>();
  private readonly withdrawalEventSubject = new Subject<any>();

  emitTransaction(data: any) {
    this.transactionEventSubject.next(data);
  }

  emitWithdrawal(data: any) {
    this.withdrawalEventSubject.next(data);
  }

  getTransactionStream() {
    return this.transactionEventSubject.asObservable();
  }

  getWithdrawalStream() {
    return this.withdrawalEventSubject.asObservable();
  }
}
