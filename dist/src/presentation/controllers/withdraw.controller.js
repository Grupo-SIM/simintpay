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
exports.WithdrawController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const list_withdrawals_query_dto_1 = require("../../application/dtos/withdraw/list-withdrawals.query.dto");
const request_withdraw_dto_1 = require("../../application/dtos/withdraw/request-withdraw.dto");
const list_withdrawals_use_case_1 = require("../../application/use-cases/withdraw/list-withdrawals.use-case");
const request_withdraw_use_case_1 = require("../../application/use-cases/withdraw/request-withdraw.use-case");
const check_pending_withdraw_use_case_1 = require("../../application/use-cases/withdraw/check-pending-withdraw.use-case");
const swagger_1 = require("@nestjs/swagger");
let WithdrawController = class WithdrawController {
    requestWithdraw;
    listWithdrawals;
    checkPending;
    constructor(requestWithdraw, listWithdrawals, checkPending) {
        this.requestWithdraw = requestWithdraw;
        this.listWithdrawals = listWithdrawals;
        this.checkPending = checkPending;
    }
    async list(user, query) {
        return this.listWithdrawals.execute({ userId: user?.sub ?? '', query });
    }
    async create(user, dto) {
        return this.requestWithdraw.execute(user?.sub ?? '', dto);
    }
    async verificarPendente(user) {
        const out = await this.checkPending.execute(user?.sub ?? '');
        return { data: out };
    }
};
exports.WithdrawController = WithdrawController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Listar saques' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: [{ requestId: 'uuid-wd-1', fee: 1.5, netAmount: 98.5, totalAmount: 100 }],
                page: 1,
                pageSize: 10,
                total: 1,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, list_withdrawals_query_dto_1.ListWithdrawalsQueryDto]),
    __metadata("design:returntype", Promise)
], WithdrawController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, swagger_1.ApiOperation)({ summary: 'Solicitar saque' }),
    (0, swagger_1.ApiBody)({
        type: request_withdraw_dto_1.RequestWithdrawDto,
        examples: {
            default: { value: { valor: 150, chavePix: '123.456.789-00' } },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        schema: { example: { data: { requestId: 'uuid-wd-1' }, message: 'Saque solicitado com sucesso' } },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        schema: { example: { statusCode: 400, message: ['O valor mínimo para saque é de R$ 100,00'] } },
    }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, request_withdraw_dto_1.RequestWithdrawDto]),
    __metadata("design:returntype", Promise)
], WithdrawController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('verificar-pendente'),
    (0, swagger_1.ApiOperation)({ summary: 'Verificar se existe saque pendente' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { hasPending: false } } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WithdrawController.prototype, "verificarPendente", null);
exports.WithdrawController = WithdrawController = __decorate([
    (0, common_1.Controller)('saques'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Saques'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [request_withdraw_use_case_1.RequestWithdrawUseCase,
        list_withdrawals_use_case_1.ListWithdrawalsUseCase,
        check_pending_withdraw_use_case_1.CheckPendingWithdrawUseCase])
], WithdrawController);
//# sourceMappingURL=withdraw.controller.js.map