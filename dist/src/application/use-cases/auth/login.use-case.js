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
exports.LoginUseCase = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const session_repository_interface_1 = require("../../../core/repositories/session.repository.interface");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const wallet_repository_interface_1 = require("../../../core/repositories/wallet.repository.interface");
const hash_interface_1 = require("../../../core/services/hash.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
const auth_tokens_service_1 = require("./auth-tokens.service");
let LoginUseCase = class LoginUseCase {
    users;
    sessions;
    wallets;
    hash;
    gateway;
    tokens;
    constructor(users, sessions, wallets, hash, gateway, tokens) {
        this.users = users;
        this.sessions = sessions;
        this.wallets = wallets;
        this.hash = hash;
        this.gateway = gateway;
        this.tokens = tokens;
    }
    async execute(input) {
        const { email, password } = input.dto;
        let user = await this.users.findByEmail(email);
        if (user) {
            const ok = await this.hash.compare(password, user.password);
            if (!ok) {
                throw new common_1.UnauthorizedException('Credenciais inválidas');
            }
        }
        else {
            const dom = await this.gateway.generateToken(email, password);
            const hashed = await this.hash.hash(password);
            user = await this.users.create({
                name: dom.name ?? email.split('@')[0] ?? 'Usuário',
                email,
                password: hashed,
                domUserId: dom.domUserId ?? null,
                domToken: dom.domToken,
            });
            const wallet = await this.wallets.findByUserId(user.id);
            if (!wallet) {
                await this.wallets.createForUser(user.id);
            }
        }
        const { token: accessToken, expiresIn } = await this.tokens.signAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });
        const refreshToken = (0, crypto_1.randomUUID)();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.sessions.create({
            userId: user.id,
            refreshToken,
            userAgent: input.userAgent ?? undefined,
            ipAddress: input.ipAddress ?? undefined,
            expiresAt,
        });
        return {
            accessToken,
            refreshToken,
            expiresIn,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        };
    }
};
exports.LoginUseCase = LoginUseCase;
exports.LoginUseCase = LoginUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __param(1, (0, common_1.Inject)(session_repository_interface_1.SESSION_REPOSITORY)),
    __param(2, (0, common_1.Inject)(wallet_repository_interface_1.WALLET_REPOSITORY)),
    __param(3, (0, common_1.Inject)(hash_interface_1.HASH_SERVICE)),
    __param(4, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object, auth_tokens_service_1.AuthTokensService])
], LoginUseCase);
//# sourceMappingURL=login.use-case.js.map