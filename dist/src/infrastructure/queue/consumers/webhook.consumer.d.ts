import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ProcessWebhookUseCase } from '../../../application/use-cases/webhook/process-webhook.use-case';
export declare class WebhookConsumer implements OnModuleInit, OnModuleDestroy {
    private readonly processWebhook;
    private readonly logger;
    private connection;
    constructor(processWebhook: ProcessWebhookUseCase);
    onModuleInit(): void;
    onModuleDestroy(): Promise<void>;
    private handleMessage;
}
