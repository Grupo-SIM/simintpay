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
exports.PrismaSessionRepository = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PrismaSessionRepository = class PrismaSessionRepository {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findByRefreshToken(refreshToken) {
        return this.prisma.session.findUnique({ where: { refreshToken } });
    }
    async create(data) {
        return this.prisma.session.create({
            data: {
                userId: data.userId,
                refreshToken: data.refreshToken,
                userAgent: data.userAgent ?? undefined,
                ipAddress: data.ipAddress ?? undefined,
                expiresAt: data.expiresAt,
            },
        });
    }
    async deleteById(id) {
        await this.prisma.session.delete({ where: { id } });
    }
    async deleteByRefreshToken(refreshToken) {
        await this.prisma.session.delete({ where: { refreshToken } });
    }
};
exports.PrismaSessionRepository = PrismaSessionRepository;
exports.PrismaSessionRepository = PrismaSessionRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrismaSessionRepository);
//# sourceMappingURL=prisma-session.repository.js.map