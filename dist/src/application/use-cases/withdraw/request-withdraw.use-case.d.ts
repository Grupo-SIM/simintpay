import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
import type { IWithdrawRepository } from '../../../core/repositories/withdraw.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { ICacheService } from '../../../core/services/cache.interface';
import type { RequestWithdrawDto } from '../../dtos/withdraw/request-withdraw.dto';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
export declare class RequestWithdrawUseCase {
    private readonly prisma;
    private readonly withdraws;
    private readonly balanceLogs;
    private readonly gateway;
    private readonly cache;
    constructor(prisma: PrismaService, withdraws: IWithdrawRepository, balanceLogs: IBalanceLogRepository, gateway: IPaymentGateway, cache: ICacheService);
    private requestOnDom;
    execute(userId: string, dto: RequestWithdrawDto): Promise<{
        data: {
            id: string;
            valor: number;
            valorBruto: number;
            taxa: number;
            status: 'PENDENTE';
            chavePix: string;
        };
        message: string;
    }>;
}
