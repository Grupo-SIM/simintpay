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
exports.DashboardSummaryUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../../infrastructure/database/prisma/prisma.service");
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
let DashboardSummaryUseCase = class DashboardSummaryUseCase {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async execute(input) {
        const now = new Date();
        const todayStart = startOfDay(now);
        const weekStart = new Date(todayStart);
        weekStart.setDate(todayStart.getDate() - 7);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        const completedWhere = {
            userId: input.userId,
            status: client_1.TransactionStatus.COMPLETED,
        };
        const [txTotal, txApproved, txPending, txRejected, txRefunded] = await this.prisma.$transaction([
            this.prisma.transaction.count({ where: { userId: input.userId } }),
            this.prisma.transaction.count({
                where: { userId: input.userId, status: client_1.TransactionStatus.COMPLETED },
            }),
            this.prisma.transaction.count({
                where: {
                    userId: input.userId,
                    status: {
                        in: [client_1.TransactionStatus.PENDING, client_1.TransactionStatus.DRAFT],
                    },
                },
            }),
            this.prisma.transaction.count({
                where: {
                    userId: input.userId,
                    status: {
                        in: [client_1.TransactionStatus.FAILED, client_1.TransactionStatus.EXPIRED],
                    },
                },
            }),
            this.prisma.transaction.count({
                where: {
                    userId: input.userId,
                    status: {
                        in: [client_1.TransactionStatus.REFUNDED, client_1.TransactionStatus.CHARGEBACK],
                    },
                },
            }),
        ]);
        const [revTodayAgg, revWeekAgg, revMonthAgg, revPrevMonthAgg] = await this.prisma.$transaction([
            this.prisma.transaction.aggregate({
                where: { ...completedWhere, createdAt: { gte: todayStart } },
                _sum: { netAmount: true },
                _count: { _all: true },
            }),
            this.prisma.transaction.aggregate({
                where: { ...completedWhere, createdAt: { gte: weekStart } },
                _sum: { netAmount: true },
                _count: { _all: true },
            }),
            this.prisma.transaction.aggregate({
                where: { ...completedWhere, createdAt: { gte: monthStart } },
                _sum: { netAmount: true },
                _count: { _all: true },
            }),
            this.prisma.transaction.aggregate({
                where: {
                    ...completedWhere,
                    createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
                },
                _sum: { netAmount: true },
                _count: { _all: true },
            }),
        ]);
        const todayValue = Number(revTodayAgg._sum.netAmount ?? 0);
        const weekValue = Number(revWeekAgg._sum.netAmount ?? 0);
        const monthValue = Number(revMonthAgg._sum.netAmount ?? 0);
        const prevMonthValue = Number(revPrevMonthAgg._sum.netAmount ?? 0);
        const variation = prevMonthValue > 0
            ? ((monthValue - prevMonthValue) / prevMonthValue) * 100
            : 0;
        const [withdrawPendingAgg, withdrawPaidAgg] = await this.prisma.$transaction([
            this.prisma.withdrawRequest.aggregate({
                where: { userId: input.userId, status: client_1.WithdrawStatus.PENDING },
                _count: { _all: true },
                _sum: { amount: true },
            }),
            this.prisma.withdrawRequest.aggregate({
                where: { userId: input.userId, status: client_1.WithdrawStatus.COMPLETED },
                _sum: { amount: true },
            }),
        ]);
        const graphFrom = new Date(todayStart);
        graphFrom.setDate(todayStart.getDate() - 6);
        const graphAgg = await this.prisma.transaction.groupBy({
            by: ['createdAt'],
            where: {
                ...completedWhere,
                createdAt: { gte: graphFrom },
            },
            _sum: { netAmount: true },
            _count: { _all: true },
        });
        const bucket = {};
        for (let i = 0; i < 7; i++) {
            const d = new Date(graphFrom);
            d.setDate(graphFrom.getDate() + i);
            const key = startOfDay(d).toISOString().slice(0, 10);
            bucket[key] = { valor: 0, quantidade: 0 };
        }
        for (const row of graphAgg) {
            const key = startOfDay(row.createdAt).toISOString().slice(0, 10);
            const item = bucket[key];
            if (!item)
                continue;
            item.valor += Number(row._sum.netAmount ?? 0);
            item.quantidade += row._count._all;
        }
        const grafico = Object.entries(bucket).map(([data, v]) => ({
            data,
            valor: v.valor,
            quantidade: v.quantidade,
        }));
        return {
            data: {
                receita: {
                    hoje: todayValue,
                    semana: weekValue,
                    mes: monthValue,
                    mesAnterior: prevMonthValue,
                    variacao: variation,
                },
                transacoes: {
                    total: txTotal,
                    aprovadas: txApproved,
                    pendentes: txPending,
                    recusadas: txRejected,
                    estornadas: txRefunded,
                },
                saques: {
                    pendentes: withdrawPendingAgg._count._all,
                    valorPendente: Number(withdrawPendingAgg._sum.amount ?? 0),
                    totalPago: Number(withdrawPaidAgg._sum.amount ?? 0),
                },
                grafico,
            },
        };
    }
};
exports.DashboardSummaryUseCase = DashboardSummaryUseCase;
exports.DashboardSummaryUseCase = DashboardSummaryUseCase = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], DashboardSummaryUseCase);
//# sourceMappingURL=dashboard-summary.use-case.js.map