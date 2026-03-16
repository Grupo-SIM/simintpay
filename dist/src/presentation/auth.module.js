"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const config_1 = require("@nestjs/config");
const auth_controller_1 = require("./controllers/auth.controller");
const health_controller_1 = require("./controllers/health.controller");
const login_use_case_1 = require("../application/use-cases/auth/login.use-case");
const register_use_case_1 = require("../application/use-cases/auth/register.use-case");
const refresh_token_use_case_1 = require("../application/use-cases/auth/refresh-token.use-case");
const logout_use_case_1 = require("../application/use-cases/auth/logout.use-case");
const get_me_use_case_1 = require("../application/use-cases/auth/get-me.use-case");
const auth_tokens_service_1 = require("../application/use-cases/auth/auth-tokens.service");
const jwt_strategy_1 = require("../infrastructure/security/strategies/jwt.strategy");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const hash_interface_1 = require("../core/services/hash.interface");
const bcrypt_service_1 = require("../infrastructure/security/bcrypt.service");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
const session_repository_interface_1 = require("../core/repositories/session.repository.interface");
const prisma_session_repository_1 = require("../infrastructure/database/repositories/prisma-session.repository");
const wallet_repository_interface_1 = require("../core/repositories/wallet.repository.interface");
const prisma_wallet_repository_1 = require("../infrastructure/database/repositories/prisma-wallet.repository");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            passport_1.PassportModule,
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET,
            }),
            api_dom_module_1.ApiDomModule,
            config_1.ConfigModule.forRoot(),
        ],
        controllers: [auth_controller_1.AuthController, health_controller_1.HealthController],
        providers: [
            jwt_strategy_1.JwtStrategy,
            auth_tokens_service_1.AuthTokensService,
            login_use_case_1.LoginUseCase,
            register_use_case_1.RegisterUseCase,
            refresh_token_use_case_1.RefreshTokenUseCase,
            logout_use_case_1.LogoutUseCase,
            get_me_use_case_1.GetMeUseCase,
            { provide: hash_interface_1.HASH_SERVICE, useClass: bcrypt_service_1.BcryptService },
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
            { provide: session_repository_interface_1.SESSION_REPOSITORY, useClass: prisma_session_repository_1.PrismaSessionRepository },
            { provide: wallet_repository_interface_1.WALLET_REPOSITORY, useClass: prisma_wallet_repository_1.PrismaWalletRepository },
        ],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map