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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const login_dto_1 = require("../../application/dtos/auth/login.dto");
const register_dto_1 = require("../../application/dtos/auth/register.dto");
const refresh_token_dto_1 = require("../../application/dtos/auth/refresh-token.dto");
const logout_dto_1 = require("../../application/dtos/auth/logout.dto");
const login_use_case_1 = require("../../application/use-cases/auth/login.use-case");
const register_use_case_1 = require("../../application/use-cases/auth/register.use-case");
const refresh_token_use_case_1 = require("../../application/use-cases/auth/refresh-token.use-case");
const logout_use_case_1 = require("../../application/use-cases/auth/logout.use-case");
const get_me_use_case_1 = require("../../application/use-cases/auth/get-me.use-case");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const request_utils_1 = require("../../shared/utils/request.utils");
const cookie_utils_1 = require("../../shared/utils/cookie.utils");
const swagger_1 = require("@nestjs/swagger");
let AuthController = class AuthController {
    login;
    register;
    refresh;
    logout;
    me;
    constructor(login, register, refresh, logout, me) {
        this.login = login;
        this.register = register;
        this.refresh = refresh;
        this.logout = logout;
        this.me = me;
    }
    async loginRoute(dto, req, res) {
        const ip = (0, request_utils_1.getRequestIp)(req) ?? req.ip ?? 'unknown';
        try {
            const out = await this.login.execute({
                dto,
                userAgent: req.headers['user-agent'] ?? null,
                ipAddress: ip,
            });
            (0, cookie_utils_1.setAccessTokenCookie)(res, out.accessToken);
            return { data: out };
        }
        catch (err) {
            throw err;
        }
    }
    async registerRoute(dto, req, res) {
        const ip = (0, request_utils_1.getRequestIp)(req) ?? req.ip ?? 'unknown';
        const out = await this.register.execute({
            dto,
            userAgent: req.headers['user-agent'] ?? null,
            ipAddress: ip,
        });
        (0, cookie_utils_1.setAccessTokenCookie)(res, out.accessToken);
        return { data: out };
    }
    async refreshRoute(dto, res) {
        const out = await this.refresh.execute({ refreshToken: dto.refreshToken });
        (0, cookie_utils_1.setAccessTokenCookie)(res, out.accessToken);
        return { data: out };
    }
    async logoutRoute(dto) {
        await this.logout.execute({ refreshToken: dto.refreshToken });
    }
    async meRoute(user) {
        const out = await this.me.execute({ userId: user?.sub ?? '' });
        return { data: out };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('login'),
    (0, swagger_1.ApiOperation)({ summary: 'Login' }),
    (0, swagger_1.ApiBody)({
        type: login_dto_1.LoginDto,
        examples: {
            default: {
                value: {
                    email: 'joao@empresa.com',
                    password: 'senha123',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: {
                    accessToken: 'jwt-access-token',
                    refreshToken: 'jwt-refresh-token',
                    user: { id: 'uuid-user-1', name: 'João', email: 'joao@empresa.com' },
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        schema: { example: { statusCode: 400, message: ['email must be an email'] } },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Credenciais inválidas' } },
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "loginRoute", null);
__decorate([
    (0, common_1.Post)('register'),
    (0, swagger_1.ApiOperation)({ summary: 'Criar conta' }),
    (0, swagger_1.ApiBody)({
        type: register_dto_1.RegisterDto,
        examples: {
            default: {
                value: {
                    name: 'João Silva',
                    email: 'joao@empresa.com',
                    password: 'senha123',
                    document: '123.456.789-00',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: {
                    accessToken: 'jwt-access-token',
                    refreshToken: 'jwt-refresh-token',
                    user: { id: 'uuid-user-1', name: 'João Silva', email: 'joao@empresa.com' },
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        schema: { example: { statusCode: 400, message: ['password must be longer than or equal to 6 characters'] } },
    }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        schema: { example: { statusCode: 409, message: 'E-mail já cadastrado' } },
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "registerRoute", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, swagger_1.ApiOperation)({ summary: 'Renovar access token' }),
    (0, swagger_1.ApiBody)({
        type: refresh_token_dto_1.RefreshTokenDto,
        examples: {
            default: { value: { refreshToken: 'jwt-refresh-token' } },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: {
                    accessToken: 'jwt-access-token',
                    refreshToken: 'jwt-refresh-token',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Refresh token inválido' } },
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [refresh_token_dto_1.RefreshTokenDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refreshRoute", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(204),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Logout' }),
    (0, swagger_1.ApiBody)({
        type: logout_dto_1.LogoutDto,
        examples: {
            default: { value: { refreshToken: 'jwt-refresh-token' } },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 204 }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Unauthorized' } },
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [logout_dto_1.LogoutDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logoutRoute", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiBearerAuth)(),
    (0, swagger_1.ApiOperation)({ summary: 'Dados do usuário autenticado' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: { id: 'uuid-user-1', name: 'João', email: 'joao@empresa.com' },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Unauthorized' } },
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "meRoute", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    (0, swagger_1.ApiTags)('Auth'),
    __metadata("design:paramtypes", [login_use_case_1.LoginUseCase,
        register_use_case_1.RegisterUseCase,
        refresh_token_use_case_1.RefreshTokenUseCase,
        logout_use_case_1.LogoutUseCase,
        get_me_use_case_1.GetMeUseCase])
], AuthController);
//# sourceMappingURL=auth.controller.js.map