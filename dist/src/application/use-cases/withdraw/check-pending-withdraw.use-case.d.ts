import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
export declare class CheckPendingWithdrawUseCase {
    private readonly withdraws;
    constructor(withdraws: IWithdrawRepository);
    execute(userId: string): Promise<{
        temPendente: boolean;
        saquePendente: {
            id: string;
            valor: number;
            valorBruto: number;
            criadoEm: string;
        } | null;
    }>;
}
