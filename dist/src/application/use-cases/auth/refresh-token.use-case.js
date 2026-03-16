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
exports.RefreshTokenUseCase = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const session_repository_interface_1 = require("../../../core/repositories/session.repository.interface");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const auth_tokens_service_1 = require("./auth-tokens.service");
let RefreshTokenUseCase = class RefreshTokenUseCase {
    sessions;
    users;
    tokens;
    constructor(sessions, users, tokens) {
        this.sessions = sessions;
        this.users = users;
        this.tokens = tokens;
    }
    async execute(input) {
        const session = await this.sessions.findByRefreshToken(input.refreshToken);
        if (!session) {
            throw new common_1.UnauthorizedException('Refresh token inválido');
        }
        if (session.expiresAt.getTime() < Date.now()) {
            await this.sessions.deleteById(session.id);
            throw new common_1.UnauthorizedException('Refresh token expirado');
        }
        const user = await this.users.findById(session.userId);
        if (!user) {
            await this.sessions.deleteById(session.id);
            throw new common_1.UnauthorizedException('Sessão inválida');
        }
        await this.sessions.deleteById(session.id);
        const { token: accessToken, expiresIn } = await this.tokens.signAccessToken({
            sub: user.id,
            email: user.email,
            role: user.role,
        });
        const newRefreshToken = (0, crypto_1.randomUUID)();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await this.sessions.create({
            userId: user.id,
            refreshToken: newRefreshToken,
            expiresAt,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
        });
        return { accessToken, refreshToken: newRefreshToken, expiresIn };
    }
};
exports.RefreshTokenUseCase = RefreshTokenUseCase;
exports.RefreshTokenUseCase = RefreshTokenUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(session_repository_interface_1.SESSION_REPOSITORY)),
    __param(1, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __metadata("design:paramtypes", [Object, Object, auth_tokens_service_1.AuthTokensService])
], RefreshTokenUseCase);
//# sourceMappingURL=refresh-token.use-case.js.map