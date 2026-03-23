import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { WithdrawController } from './controllers/withdraw.controller';
import { WITHDRAW_REPOSITORY } from '../core/repositories/withdraw.repository.interface';
import { PrismaWithdrawRepository } from '../infrastructure/database/repositories/prisma-withdraw.repository';
import { BALANCE_LOG_REPOSITORY } from '../core/repositories/balance-log.repository.interface';
import { PrismaBalanceLogRepository } from '../infrastructure/database/repositories/prisma-balance-log.repository';
import { RequestWithdrawUseCase } from '../application/use-cases/withdraw/request-withdraw.use-case';
import { ListWithdrawalsUseCase } from '../application/use-cases/withdraw/list-withdrawals.use-case';
import { CheckPendingWithdrawUseCase } from '../application/use-cases/withdraw/check-pending-withdraw.use-case';
import { GetWithdrawSummaryUseCase } from '../application/use-cases/withdraw/get-withdraw-summary.use-case';
import { CACHE_SERVICE } from '../core/services/cache.interface';
import { NoopCacheService } from '../infrastructure/cache/noop-cache.service';
import { AuthModule } from './auth.module';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../core/repositories/wallet.repository.interface';

@Module({
  imports: [AuthModule, ApiDomModule],
  controllers: [WithdrawController],
  providers: [
    RequestWithdrawUseCase,
    ListWithdrawalsUseCase,
    CheckPendingWithdrawUseCase,
    GetWithdrawSummaryUseCase,
    { provide: WITHDRAW_REPOSITORY, useClass: PrismaWithdrawRepository },
    { provide: BALANCE_LOG_REPOSITORY, useClass: PrismaBalanceLogRepository },
    { provide: CACHE_SERVICE, useClass: NoopCacheService },
  ],
})
export class WithdrawModule {}
