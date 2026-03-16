import { PaymentLink } from '@prisma/client';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaPaymentLinkRepository implements IPaymentLinkRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(data: {
        userId: string;
        title: string;
        description?: string | null;
        amount: number;
        maxInstallments: number;
        isActive?: boolean;
        domPaymentLinkId?: string | null;
    }): Promise<PaymentLink>;
    findManyByUserId(input: {
        userId: string;
        page: number;
        pageSize: number;
    }): Promise<{
        total: number;
        items: PaymentLink[];
    }>;
    findById(id: string): Promise<PaymentLink | null>;
    findByIdForUser(input: {
        id: string;
        userId: string;
    }): Promise<PaymentLink | null>;
    update(id: string, data: Partial<{
        title: string;
        description?: string | null;
        amount: number;
        maxInstallments: number;
        isActive: boolean;
        domPaymentLinkId?: string | null;
    }>): Promise<PaymentLink>;
    delete(id: string): Promise<void>;
}
