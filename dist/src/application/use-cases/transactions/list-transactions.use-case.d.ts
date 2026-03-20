import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { type IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { ListTransactionsQueryDto } from '../../dtos/transactions/list-transactions.query.dto';
export declare class ListTransactionsUseCase {
    private readonly prisma;
    private readonly gateway;
    constructor(prisma: PrismaService, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
        query: ListTransactionsQueryDto;
    }): Promise<{
        data: Array<{
            id: string;
            valor: number;
            valorLiquido: number | null;
            status: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';
            metodo: 'PIX' | 'CREDIT_CARD';
            descricao: string | null;
            parcelas: number;
            cliente: {
                nome: string | null;
                email: string | null;
                documento: string | null;
            };
            taxas: {
                total: number;
                dom: number;
                plataforma: number;
            };
            criadoEm: string;
        }>;
        page: number;
        pageSize: number;
        total: number;
    }>;
}
