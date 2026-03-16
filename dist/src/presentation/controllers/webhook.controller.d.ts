import type { Request } from 'express';
import { type IQueueService } from '../../core/services/queue.interface';
export declare class WebhookController {
    private readonly queue;
    private readonly logger;
    constructor(queue: IQueueService);
    handle(body: unknown, signature: string | undefined, secretHeader: string | undefined, req: Request & {
        rawBody?: Buffer;
    }): Promise<{
        status: string;
    }>;
}
