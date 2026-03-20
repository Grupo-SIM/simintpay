import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListTransactionsQueryDto } from '../../application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../../application/use-cases/transactions/list-transactions.use-case';
import { GetTransactionDetailsUseCase } from '../../application/use-cases/transactions/get-transaction-details.use-case';
export declare class TransactionsController {
    private readonly list;
    private readonly detail;
    constructor(list: ListTransactionsUseCase, detail: GetTransactionDetailsUseCase);
    listRoute(user: JwtPayload | undefined, query: ListTransactionsQueryDto): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
    detailRoute(user: JwtPayload | undefined, id: string): Promise<any>;
}
