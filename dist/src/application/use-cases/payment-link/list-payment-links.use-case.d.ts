import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { ListPaymentLinksQueryDto } from '../../dtos/payment-link/list-payment-links.query.dto';
export declare class ListPaymentLinksUseCase {
    private readonly links;
    constructor(links: IPaymentLinkRepository);
    execute(input: {
        userId: string;
        query: ListPaymentLinksQueryDto;
    }): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
}
