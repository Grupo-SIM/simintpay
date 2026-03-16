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
exports.PrismaPaymentLinkRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaPaymentLinkRepository = class PrismaPaymentLinkRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(data) {
        return this.prisma.paymentLink.create({
            data: {
                userId: data.userId,
                title: data.title,
                description: data.description ?? undefined,
                amount: new client_1.Prisma.Decimal(data.amount),
                maxInstallments: data.maxInstallments,
                isActive: data.isActive ?? true,
                domPaymentLinkId: data.domPaymentLinkId ?? undefined,
            },
        });
    }
    async findManyByUserId(input) {
        const [total, items] = await this.prisma.$transaction([
            this.prisma.paymentLink.count({ where: { userId: input.userId } }),
            this.prisma.paymentLink.findMany({
                where: { userId: input.userId },
                orderBy: { createdAt: 'desc' },
                skip: (input.page - 1) * input.pageSize,
                take: input.pageSize,
            }),
        ]);
        return { total, items };
    }
    async findById(id) {
        return this.prisma.paymentLink.findUnique({ where: { id } });
    }
    async findByIdForUser(input) {
        return this.prisma.paymentLink.findFirst({
            where: { id: input.id, userId: input.userId },
        });
    }
    async update(id, data) {
        return this.prisma.paymentLink.update({
            where: { id },
            data: {
                title: data.title,
                description: data.description ?? undefined,
                amount: data.amount != null ? new client_1.Prisma.Decimal(data.amount) : undefined,
                maxInstallments: data.maxInstallments,
                isActive: data.isActive,
                domPaymentLinkId: data.domPaymentLinkId ?? undefined,
            },
        });
    }
    async delete(id) {
        await this.prisma.paymentLink.delete({ where: { id } });
    }
};
exports.PrismaPaymentLinkRepository = PrismaPaymentLinkRepository;
exports.PrismaPaymentLinkRepository = PrismaPaymentLinkRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaPaymentLinkRepository);
//# sourceMappingURL=prisma-payment-link.repository.js.map