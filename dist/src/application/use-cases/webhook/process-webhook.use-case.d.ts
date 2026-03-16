import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { ITransactionRepository } from '../../../core/repositories/transaction.repository.interface';
import type { IWebhookEventRepository } from '../../../core/repositories/webhook-event.repository.interface';
import type { IBalanceLogRepository } from '../../../core/repositories/balance-log.repository.interface';
type WebhookPayload = Record<string, unknown>;
export declare class ProcessWebhookUseCase {
    private readonly events;
    private readonly transactions;
    private readonly balanceLogs;
    private readonly prisma;
    constructor(events: IWebhookEventRepository, transactions: ITransactionRepository, balanceLogs: IBalanceLogRepository, prisma: PrismaService);
    private getObject;
    private getString;
    private toDecimal;
    private parseDomPayload;
    private mapDomStatusToTransactionStatus;
    private isValidTransition;
    execute(input: {
        payload: WebhookPayload;
    }): Promise<void>;
}
export {};
