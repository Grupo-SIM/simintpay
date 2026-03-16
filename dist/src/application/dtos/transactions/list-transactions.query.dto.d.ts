export declare class ListTransactionsQueryDto {
    page?: number;
    pageSize?: number;
    status?: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';
    q?: string;
    dataInicio?: string;
    dataFim?: string;
    metodo?: 'PIX' | 'CREDIT_CARD';
}
