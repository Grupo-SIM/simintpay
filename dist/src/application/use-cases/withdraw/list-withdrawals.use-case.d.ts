import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { ListWithdrawalsQueryDto } from '../../dtos/withdraw/list-withdrawals.query.dto';
export declare class ListWithdrawalsUseCase {
    private readonly withdraws;
    constructor(withdraws: IWithdrawRepository);
    execute(input: {
        userId: string;
        query: ListWithdrawalsQueryDto;
    }): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
}
