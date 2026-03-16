import { Module } from '@nestjs/common';
import { TransactionsController } from './controllers/transactions.controller';
import { ListTransactionsUseCase } from '../application/use-cases/transactions/list-transactions.use-case';

@Module({
  controllers: [TransactionsController],
  providers: [ListTransactionsUseCase],
})
export class TransactionsModule {}
