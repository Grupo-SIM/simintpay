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
exports.PrismaWithdrawRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaWithdrawRepository = class PrismaWithdrawRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findPendingByUserId(userId) {
        return this.prisma.withdrawRequest.findFirst({
            where: { userId, status: client_1.WithdrawStatus.PENDING },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findByUserId(input) {
        const where = {
            userId: input.userId,
            status: input.status,
        };
        const [total, items] = await this.prisma.$transaction([
            this.prisma.withdrawRequest.count({ where }),
            this.prisma.withdrawRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (input.page - 1) * input.pageSize,
                take: input.pageSize,
                include: { user: { select: { name: true, email: true } } },
            }),
        ]);
        return { total, items };
    }
    async createWithWalletLock(input) {
        return this.prisma.$transaction(async (tx) => {
            const created = await tx.withdrawRequest.create({
                data: {
                    userId: input.userId,
                    amount: new client_1.Prisma.Decimal(input.amount),
                    grossAmount: new client_1.Prisma.Decimal(input.grossAmount),
                    fee: new client_1.Prisma.Decimal(input.fee),
                    status: client_1.WithdrawStatus.PENDING,
                    pixKey: input.pixKey,
                    domWithdrawId: input.domWithdrawId,
                },
            });
            const updated = await tx.wallet.updateMany({
                where: { userId: input.userId, version: input.currentWalletVersion },
                data: {
                    lockedBalance: { increment: new client_1.Prisma.Decimal(input.amountToLock) },
                    version: { increment: 1 },
                },
            });
            if (updated.count === 0) {
                throw new Error('Wallet version conflict — retry');
            }
            return created;
        });
    }
};
exports.PrismaWithdrawRepository = PrismaWithdrawRepository;
exports.PrismaWithdrawRepository = PrismaWithdrawRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaWithdrawRepository);
//# sourceMappingURL=prisma-withdraw.repository.js.map