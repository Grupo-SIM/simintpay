import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import { ListPaymentLinksQueryDto } from '../../application/dtos/payment-link/list-payment-links.query.dto';
import { CreatePaymentLinkUseCase } from '../../application/use-cases/payment-link/create-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../../application/use-cases/payment-link/list-payment-links.use-case';
import { GetPaymentLinkUseCase } from '../../application/use-cases/payment-link/get-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../../application/use-cases/payment-link/update-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../../application/use-cases/payment-link/delete-payment-link.use-case';
export declare class PaymentLinkController {
    private readonly create;
    private readonly list;
    private readonly getOne;
    private readonly update;
    private readonly del;
    constructor(create: CreatePaymentLinkUseCase, list: ListPaymentLinksUseCase, getOne: GetPaymentLinkUseCase, update: UpdatePaymentLinkUseCase, del: DeletePaymentLinkUseCase);
    listRoute(user: JwtPayload | undefined, query: ListPaymentLinksQueryDto): Promise<{
        data: unknown;
        page: number;
        pageSize: number;
        total: number;
    }>;
    createRoute(user: JwtPayload | undefined, dto: CreatePaymentLinkDto): Promise<{
        data: unknown;
    }>;
    getRoute(user: JwtPayload | undefined, id: string): Promise<{
        data: unknown;
    }>;
    updateRoute(user: JwtPayload | undefined, id: string, dto: UpdatePaymentLinkDto): Promise<{
        data: unknown;
    }>;
    deleteRoute(user: JwtPayload | undefined, id: string): Promise<{
        deleted: true;
    }>;
}
