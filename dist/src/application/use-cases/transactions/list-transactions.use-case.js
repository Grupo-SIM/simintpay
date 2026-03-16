"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListTransactionsUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../../infrastructure/database/prisma/prisma.service");
function mapInternalStatusToPt(status) {
    switch (status) {
        case client_1.TransactionStatus.COMPLETED:
            return 'APROVADA';
        case client_1.TransactionStatus.PENDING:
        case client_1.TransactionStatus.DRAFT:
            return 'PENDENTE';
        case client_1.TransactionStatus.FAILED:
        case client_1.TransactionStatus.EXPIRED:
            return 'RECUSADA';
        case client_1.TransactionStatus.REFUNDED:
        case client_1.TransactionStatus.CHARGEBACK:
            return 'ESTORNADA';
        default:
            return 'PENDENTE';
    }
}
function mapPtStatusToInternal(status) {
    switch (status) {
        case 'APROVADA':
            return [client_1.TransactionStatus.COMPLETED];
        case 'PENDENTE':
            return [client_1.TransactionStatus.PENDING, client_1.TransactionStatus.DRAFT];
        case 'RECUSADA':
            return [client_1.TransactionStatus.FAILED, client_1.TransactionStatus.EXPIRED];
        case 'ESTORNADA':
            return [client_1.TransactionStatus.REFUNDED, client_1.TransactionStatus.CHARGEBACK];
        default:
            return undefined;
    }
}
let ListTransactionsUseCase = class ListTransactionsUseCase {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async execute(input) {
        const page = input.query.page ?? 1;
        const pageSize = input.query.pageSize ?? 20;
        const where = {
            userId: input.userId,
        };
        const statuses = mapPtStatusToInternal(input.query.status);
        if (statuses) {
            where.status = { in: statuses };
        }
        if (input.query.metodo) {
            where.paymentMethod =
                input.query.metodo === 'PIX'
                    ? client_1.PaymentMethod.PIX
                    : client_1.PaymentMethod.CREDIT_CARD;
        }
        const q = input.query.q?.trim();
        if (q && q.length > 0) {
            where.OR = [
                { description: { contains: q, mode: 'insensitive' } },
                { customerEmail: { contains: q, mode: 'insensitive' } },
                { customerName: { contains: q, mode: 'insensitive' } },
            ];
        }
        if (input.query.dataInicio || input.query.dataFim) {
            const createdAt = {};
            if (input.query.dataInicio) {
                const d = new Date(input.query.dataInicio);
                if (!Number.isNaN(d.getTime()))
                    createdAt.gte = d;
            }
            if (input.query.dataFim) {
                const d = new Date(input.query.dataFim);
                if (!Number.isNaN(d.getTime()))
                    createdAt.lte = d;
            }
            where.createdAt = createdAt;
        }
        const [total, items] = await this.prisma.$transaction([
            this.prisma.transaction.count({ where }),
            this.prisma.transaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);
        return {
            data: items.map((t) => ({
                id: t.id,
                valor: Number(t.amount),
                valorLiquido: t.netAmount != null ? Number(t.netAmount) : null,
                status: mapInternalStatusToPt(t.status),
                metodo: t.paymentMethod,
                descricao: t.description ?? null,
                parcelas: t.installments,
                cliente: {
                    nome: t.customerName ?? null,
                    email: t.customerEmail ?? null,
                    documento: t.customerDocument ?? null,
                },
                taxas: {
                    total: Number(t.totalFee),
                    dom: Number(t.domFee),
                    plataforma: Number(t.platformFee),
                },
                criadoEm: t.createdAt.toISOString(),
            })),
            page,
            pageSize,
            total,
        };
    }
};
exports.ListTransactionsUseCase = ListTransactionsUseCase;
exports.ListTransactionsUseCase = ListTransactionsUseCase = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ListTransactionsUseCase);
//# sourceMappingURL=list-transactions.use-case.js.map