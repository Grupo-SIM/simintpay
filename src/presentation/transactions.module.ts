import { Module } from '@nestjs/common';
import { TransactionsController } from './controllers/transactions.controller';
import { ListTransactionsUseCase } from '../application/use-cases/transactions/list-transactions.use-case';
import { GetTransactionDetailsUseCase } from '../application/use-cases/transactions/get-transaction-details.use-case';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';

@Module({
  imports: [ApiDomModule],
  controllers: [TransactionsController],
  providers: [ListTransactionsUseCase, GetTransactionDetailsUseCase],
})
export class TransactionsModule {}
