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
exports.GetMeUseCase = void 0;
const common_1 = require("@nestjs/common");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const wallet_repository_interface_1 = require("../../../core/repositories/wallet.repository.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
let GetMeUseCase = class GetMeUseCase {
    users;
    wallets;
    gateway;
    constructor(users, wallets, gateway) {
        this.users = users;
        this.wallets = wallets;
        this.gateway = gateway;
    }
    async execute(input) {
        const user = await this.users.findById(input.userId);
        if (!user) {
            throw new common_1.UnauthorizedException('Usuário não encontrado');
        }
        const wallet = await this.wallets.findByUserId(user.id);
        if (!wallet) {
            throw new common_1.UnauthorizedException('Wallet não encontrada');
        }
        const balance = Number(wallet.balance);
        const lockedBalance = Number(wallet.lockedBalance);
        const availableBalance = balance - lockedBalance;
        const netBalance = availableBalance;
        if (user.domToken) {
            try {
                const domMe = await this.gateway.me(user.domToken);
                if (domMe.name || domMe.email) {
                    return {
                        id: user.id,
                        name: domMe.name ?? user.name,
                        email: domMe.email ?? user.email,
                        role: user.role,
                        isAdmin: user.role === 'ADMIN',
                        wallet: {
                            balance,
                            lockedBalance,
                            availableBalance,
                            netBalance,
                        },
                        createdAt: user.createdAt.toISOString(),
                    };
                }
            }
            catch {
            }
        }
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            isAdmin: user.role === 'ADMIN',
            wallet: {
                balance,
                lockedBalance,
                availableBalance,
                netBalance,
            },
            createdAt: user.createdAt.toISOString(),
        };
    }
};
exports.GetMeUseCase = GetMeUseCase;
exports.GetMeUseCase = GetMeUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __param(1, (0, common_1.Inject)(wallet_repository_interface_1.WALLET_REPOSITORY)),
    __param(2, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [Object, Object, Object])
], GetMeUseCase);
//# sourceMappingURL=get-me.use-case.js.map