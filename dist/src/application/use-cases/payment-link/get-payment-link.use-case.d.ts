import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
export declare class GetPaymentLinkUseCase {
    private readonly links;
    constructor(links: IPaymentLinkRepository);
    execute(input: {
        userId: string;
        id: string;
    }): Promise<{
        data: unknown;
    }>;
}
