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
exports.PrismaSubscriptionRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaSubscriptionRepository = class PrismaSubscriptionRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(data) {
        return this.prisma.subscription.create({
            data: {
                userId: data.userId,
                planId: data.planId,
                customerId: data.customerId ?? undefined,
                status: data.status ?? 'active',
                expiresAt: data.expiresAt ?? undefined,
                totalDaysCredited: data.totalDaysCredited ?? 0,
                domSubscriptionId: data.domSubscriptionId ?? undefined,
            },
        });
    }
    async findManyByUserId(input) {
        const where = {
            userId: input.userId,
            status: input.status ? input.status : undefined,
            planId: input.planId ? input.planId : undefined,
        };
        const [total, items] = await this.prisma.$transaction([
            this.prisma.subscription.count({ where }),
            this.prisma.subscription.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (input.page - 1) * input.pageSize,
                take: input.pageSize,
            }),
        ]);
        return { total, items };
    }
    async findByIdForUser(input) {
        return this.prisma.subscription.findFirst({
            where: { id: input.id, userId: input.userId },
        });
    }
    async update(id, data) {
        return this.prisma.subscription.update({
            where: { id },
            data: {
                planId: data.planId,
                customerId: data.customerId ?? undefined,
                status: data.status,
                expiresAt: data.expiresAt ?? undefined,
                totalDaysCredited: data.totalDaysCredited,
                domSubscriptionId: data.domSubscriptionId ?? undefined,
            },
        });
    }
};
exports.PrismaSubscriptionRepository = PrismaSubscriptionRepository;
exports.PrismaSubscriptionRepository = PrismaSubscriptionRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaSubscriptionRepository);
//# sourceMappingURL=prisma-subscription.repository.js.map