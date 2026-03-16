import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListSubscribersQueryDto } from '../../application/dtos/subscription/list-subscribers.query.dto';
import { ListSubscribersUseCase } from '../../application/use-cases/subscription/list-subscribers.use-case';
import { CancelSubscriptionUseCase } from '../../application/use-cases/subscription/cancel-subscription.use-case';
export declare class SubscriptionController {
    private readonly listSubscribers;
    private readonly cancel;
    constructor(listSubscribers: ListSubscribersUseCase, cancel: CancelSubscriptionUseCase);
    listSubscribersRoute(user: JwtPayload | undefined, query: ListSubscribersQueryDto): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
    cancelRoute(user: JwtPayload | undefined, id: string): Promise<{
        cancelled: true;
    }>;
}
