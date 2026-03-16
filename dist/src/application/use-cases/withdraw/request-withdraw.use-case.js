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
exports.RequestWithdrawUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const balance_log_repository_interface_1 = require("../../../core/repositories/balance-log.repository.interface");
const withdraw_repository_interface_1 = require("../../../core/repositories/withdraw.repository.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
const cache_interface_1 = require("../../../core/services/cache.interface");
const prisma_service_1 = require("../../../infrastructure/database/prisma/prisma.service");
const FEE = 2;
const NET_PERCENT = 0.91;
let RequestWithdrawUseCase = class RequestWithdrawUseCase {
    prisma;
    withdraws;
    balanceLogs;
    gateway;
    cache;
    constructor(prisma, withdraws, balanceLogs, gateway, cache) {
        this.prisma = prisma;
        this.withdraws = withdraws;
        this.balanceLogs = balanceLogs;
        this.gateway = gateway;
        this.cache = cache;
    }
    async requestOnDom(input) {
        return this.gateway.requestWithdraw(input.domToken, {
            amount: input.dto.valor,
            pixKey: input.dto.chavePix,
        });
    }
    async execute(userId, dto) {
        const pending = await this.withdraws.findPendingByUserId(userId);
        if (pending) {
            throw new common_1.ConflictException('Você já possui um saque pendente. Aguarde a aprovação antes de solicitar um novo.');
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { domToken: true },
        });
        if (!user?.domToken) {
            throw new common_1.UnauthorizedException('Usuário não autenticado na api-dom');
        }
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
        });
        if (!wallet)
            throw new common_1.NotFoundException('Wallet não encontrada');
        const balance = Number(wallet.balance);
        const locked = Number(wallet.lockedBalance);
        const availableBalance = balance - locked;
        if (dto.valor > availableBalance - FEE) {
            throw new common_1.UnprocessableEntityException('Saldo insuficiente para saque (considere a taxa de R$ 2,00)');
        }
        const domRes = await this.requestOnDom({ domToken: user.domToken, dto });
        const amountToLock = dto.valor;
        const beforeLocked = Number(wallet.lockedBalance);
        const beforeBalance = Number(wallet.balance);
        let created;
        try {
            created = await this.withdraws.createWithWalletLock({
                userId,
                amount: domRes.netAmount,
                grossAmount: dto.valor,
                fee: domRes.fee,
                pixKey: dto.chavePix,
                domWithdrawId: domRes.requestId,
                amountToLock,
                currentWalletVersion: wallet.version,
            });
        }
        catch (e) {
            if (e instanceof Error && e.message.includes('Wallet version conflict')) {
                throw new common_1.UnprocessableEntityException('Conflito ao atualizar wallet. Tente novamente.');
            }
            throw e;
        }
        const afterLocked = beforeLocked + amountToLock;
        await this.balanceLogs.create({
            userId,
            action: 'WITHDRAW_REQUESTED',
            amount: new client_1.Prisma.Decimal(-amountToLock).toFixed(2),
            balanceBefore: new client_1.Prisma.Decimal(beforeBalance).toFixed(2),
            balanceAfter: new client_1.Prisma.Decimal(beforeBalance).toFixed(2),
            lockedBefore: new client_1.Prisma.Decimal(beforeLocked).toFixed(2),
            lockedAfter: new client_1.Prisma.Decimal(afterLocked).toFixed(2),
            source: 'WITHDRAW',
            description: 'Solicitação de saque',
        });
        await this.cache.delete(`wallet:${userId}`);
        return {
            data: {
                id: created.id,
                valor: Number(created.amount),
                valorBruto: Number(created.grossAmount),
                taxa: Number(created.fee),
                status: 'PENDENTE',
                chavePix: created.pixKey,
            },
            message: 'Saque solicitado com sucesso',
        };
    }
};
exports.RequestWithdrawUseCase = RequestWithdrawUseCase;
exports.RequestWithdrawUseCase = RequestWithdrawUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(withdraw_repository_interface_1.WITHDRAW_REPOSITORY)),
    __param(2, (0, common_1.Inject)(balance_log_repository_interface_1.BALANCE_LOG_REPOSITORY)),
    __param(3, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __param(4, (0, common_1.Inject)(cache_interface_1.CACHE_SERVICE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, Object, Object, Object])
], RequestWithdrawUseCase);
//# sourceMappingURL=request-withdraw.use-case.js.map