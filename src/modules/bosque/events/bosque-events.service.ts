import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class BosqueEventsService {
  private readonly transactionEventSubject = new Subject<any>();

  emitTransaction(data: any) {
    this.transactionEventSubject.next(data);
  }

  getTransactionStream() {
    return this.transactionEventSubject.asObservable();
  }
}
