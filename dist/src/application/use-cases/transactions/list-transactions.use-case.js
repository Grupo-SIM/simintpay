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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListTransactionsUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../../infrastructure/database/prisma/prisma.service");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
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
function mapDomStatusToTransactionStatus(status) {
    const s = status.toLowerCase();
    if (s === 'paid' || s === 'approved' || s === 'completed')
        return client_1.TransactionStatus.COMPLETED;
    if (s === 'refunded' || s === 'chargeback')
        return client_1.TransactionStatus.REFUNDED;
    if (s === 'failed' || s === 'rejected' || s === 'expired')
        return client_1.TransactionStatus.FAILED;
    return client_1.TransactionStatus.PENDING;
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
    gateway;
    constructor(prisma, gateway) {
        this.prisma = prisma;
        this.gateway = gateway;
    }
    async execute(input) {
        const user = await this.prisma.user.findUnique({ where: { id: input.userId } });
        if (user?.domToken) {
            try {
                const domRes = await this.gateway.listDomTransactions(user.domToken, { page: 1, limit: 100 });
                let domTaxes = null;
                const masterKey = process.env.API_DOM_MASTER_KEY;
                if (masterKey) {
                    try {
                        domTaxes = await this.gateway.getTaxes(masterKey);
                        console.log('[Sync] Taxes PIX:', domTaxes?.pix, '| Card parcelas:', domTaxes?.cartaoCredito?.tabelaParcelas?.length);
                    }
                    catch (err) {
                        console.error('[Sync] Failed to fetch taxes:', err.message);
                    }
                }
                for (const item of domRes.transactions) {
                    const amount = new client_1.Prisma.Decimal(item.amount / 100);
                    const liquidRaw = item.liquid_amount ?? 0;
                    const netAmount = new client_1.Prisma.Decimal(liquidRaw > 0 ? liquidRaw / 100 : 0);
                    const totalFee = amount.sub(netAmount);
                    let calcDomFee = item.mdr_value != null ? new client_1.Prisma.Decimal(item.mdr_value) : undefined;
                    if (!calcDomFee && domTaxes) {
                        const isCard = item.payment_method?.toUpperCase().includes('CARD');
                        const amt = item.amount / 100;
                        if (!isCard && domTaxes.pix) {
                            const pct = domTaxes.pix.percentual ?? 0;
                            const fixed = domTaxes.pix.fixo ?? 0;
                            calcDomFee = new client_1.Prisma.Decimal(amt * (pct / 100) + fixed);
                        }
                        else if (isCard && domTaxes.cartaoCredito?.tabelaParcelas) {
                            const installments = item.installments ?? 1;
                            const row = domTaxes.cartaoCredito.tabelaParcelas.find(r => Number(r.parcelas) === installments);
                            if (row)
                                calcDomFee = new client_1.Prisma.Decimal(amt * (parseFloat(row.taxaDom) / 100));
                        }
                    }
                    const calcPlatformFee = calcDomFee
                        ? client_1.Prisma.Decimal.max(new client_1.Prisma.Decimal(0), totalFee.sub(calcDomFee))
                        : undefined;
                    const parsedDate = item.created_at
                        ? new Date(item.created_at.replace(' ', 'T'))
                        : new Date();
                    const createdAt = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
                    const domPaymentId = item.order_id || item.cod_external || item.id;
                    await this.prisma.transaction.upsert({
                        where: { domPaymentId },
                        update: {
                            status: mapDomStatusToTransactionStatus(item.status),
                            amount,
                            netAmount,
                            totalFee,
                            ...(calcDomFee !== undefined && { domFee: calcDomFee }),
                            ...(calcPlatformFee !== undefined && { platformFee: calcPlatformFee }),
                            customerName: item.customer_name,
                            customerEmail: item.customer_email,
                            customerDocument: item.customer_document,
                            customerPhone: item.customer_phone,
                            updatedAt: new Date(),
                        },
                        create: {
                            userId: user.id,
                            amount,
                            netAmount,
                            totalFee,
                            ...(calcDomFee !== undefined && { domFee: calcDomFee }),
                            ...(calcPlatformFee !== undefined && { platformFee: calcPlatformFee }),
                            status: mapDomStatusToTransactionStatus(item.status),
                            paymentMethod: item.payment_method?.toUpperCase().includes('CARD') ? client_1.PaymentMethod.CREDIT_CARD : client_1.PaymentMethod.PIX,
                            domTransactionId: item.id,
                            domPaymentId,
                            customerName: item.customer_name,
                            customerEmail: item.customer_email,
                            customerDocument: item.customer_document,
                            customerPhone: item.customer_phone,
                            description: item.product_first,
                            createdAt,
                        }
                    }).catch(err => console.error(`Erro ao sincronizar transação ${item.id}:`, err.message));
                }
            }
            catch (err) {
                console.error('[Sync Error]', err.message);
            }
        }
        const page = input.query.page ?? 1;
        const pageSize = input.query.pageSize ?? 20;
        const and = [{ userId: input.userId }];
        const statuses = mapPtStatusToInternal(input.query.status);
        if (statuses) {
            and.push({ status: { in: statuses } });
        }
        if (input.query.metodo) {
            and.push({
                paymentMethod: input.query.metodo === 'PIX'
                    ? client_1.PaymentMethod.PIX
                    : client_1.PaymentMethod.CREDIT_CARD,
            });
        }
        const q = input.query.q?.trim();
        if (q && q.length > 0) {
            and.push({
                OR: [
                    { id: { contains: q, mode: 'insensitive' } },
                    { domTransactionId: { contains: q, mode: 'insensitive' } },
                    { description: { contains: q, mode: 'insensitive' } },
                    { customerEmail: { contains: q, mode: 'insensitive' } },
                    { customerName: { contains: q, mode: 'insensitive' } },
                    { customerDocument: { contains: q, mode: 'insensitive' } },
                ],
            });
        }
        if (input.query.id) {
            and.push({
                OR: [
                    { id: { contains: input.query.id, mode: 'insensitive' } },
                    { domTransactionId: { contains: input.query.id, mode: 'insensitive' } },
                ],
            });
        }
        if (input.query.customerName) {
            and.push({ customerName: { contains: input.query.customerName, mode: 'insensitive' } });
        }
        if (input.query.customerEmail) {
            and.push({ customerEmail: { contains: input.query.customerEmail, mode: 'insensitive' } });
        }
        if (input.query.customerDocument) {
            and.push({ customerDocument: { contains: input.query.customerDocument, mode: 'insensitive' } });
        }
        if (input.query.domTransactionId) {
            and.push({ domTransactionId: { contains: input.query.domTransactionId, mode: 'insensitive' } });
        }
        if (input.query.dataInicio || input.query.dataFim) {
            const createdAt = {};
            if (input.query.dataInicio) {
                const d = new Date(input.query.dataInicio);
                if (!Number.isNaN(d.getTime())) {
                    d.setUTCHours(0, 0, 0, 0);
                    createdAt.gte = d;
                }
            }
            if (input.query.dataFim) {
                const d = new Date(input.query.dataFim);
                if (!Number.isNaN(d.getTime())) {
                    d.setUTCHours(23, 59, 59, 999);
                    createdAt.lte = d;
                }
            }
            and.push({ createdAt });
        }
        const where = { AND: and };
        const [total, items] = await Promise.all([
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
    __param(1, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object])
], ListTransactionsUseCase);
//# sourceMappingURL=list-transactions.use-case.js.map