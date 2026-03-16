import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListWithdrawalsQueryDto } from '../../application/dtos/withdraw/list-withdrawals.query.dto';
import { RequestWithdrawDto } from '../../application/dtos/withdraw/request-withdraw.dto';
import { ListWithdrawalsUseCase } from '../../application/use-cases/withdraw/list-withdrawals.use-case';
import { RequestWithdrawUseCase } from '../../application/use-cases/withdraw/request-withdraw.use-case';
import { CheckPendingWithdrawUseCase } from '../../application/use-cases/withdraw/check-pending-withdraw.use-case';
export declare class WithdrawController {
    private readonly requestWithdraw;
    private readonly listWithdrawals;
    private readonly checkPending;
    constructor(requestWithdraw: RequestWithdrawUseCase, listWithdrawals: ListWithdrawalsUseCase, checkPending: CheckPendingWithdrawUseCase);
    list(user: JwtPayload | undefined, query: ListWithdrawalsQueryDto): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
    create(user: JwtPayload | undefined, dto: RequestWithdrawDto): Promise<unknown>;
    verificarPendente(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
}
