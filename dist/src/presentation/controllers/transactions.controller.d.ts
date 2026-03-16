import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListTransactionsQueryDto } from '../../application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../../application/use-cases/transactions/list-transactions.use-case';
export declare class TransactionsController {
    private readonly list;
    constructor(list: ListTransactionsUseCase);
    listRoute(user: JwtPayload | undefined, query: ListTransactionsQueryDto): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
}
