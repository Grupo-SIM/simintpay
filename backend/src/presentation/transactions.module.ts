import { Module } from '@nestjs/common';
import { TransactionsController } from './controllers/transactions.controller';
import { PublicUserController } from './controllers/public-user.controller';
import { ListTransactionsUseCase } from '../application/use-cases/transactions/list-transactions.use-case';
import { GetTransactionDetailsUseCase } from '../application/use-cases/transactions/get-transaction-details.use-case';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';

@Module({
  imports: [ApiDomModule],
  controllers: [TransactionsController, PublicUserController],
  providers: [ListTransactionsUseCase, GetTransactionDetailsUseCase],
})
export class TransactionsModule {}
