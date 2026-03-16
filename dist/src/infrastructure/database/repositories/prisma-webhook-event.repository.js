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
exports.PrismaWebhookEventRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaWebhookEventRepository = class PrismaWebhookEventRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findByEventId(eventId) {
        return this.prisma.webhookEvent.findUnique({ where: { eventId } });
    }
    async create(data) {
        return this.prisma.webhookEvent.create({
            data: {
                eventId: data.eventId,
                source: data.source,
                eventType: data.eventType,
                payload: data.payload,
            },
        });
    }
    async markProcessed(id) {
        await this.prisma.webhookEvent.update({
            where: { id },
            data: { status: 'PROCESSED', processedAt: new Date(), error: null },
        });
    }
    async markFailed(id, error) {
        await this.prisma.webhookEvent.update({
            where: { id },
            data: {
                status: 'FAILED',
                error,
                retryCount: { increment: 1 },
            },
        });
    }
};
exports.PrismaWebhookEventRepository = PrismaWebhookEventRepository;
exports.PrismaWebhookEventRepository = PrismaWebhookEventRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaWebhookEventRepository);
//# sourceMappingURL=prisma-webhook-event.repository.js.map