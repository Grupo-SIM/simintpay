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
exports.TransactionsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const list_transactions_query_dto_1 = require("../../application/dtos/transactions/list-transactions.query.dto");
const list_transactions_use_case_1 = require("../../application/use-cases/transactions/list-transactions.use-case");
const swagger_1 = require("@nestjs/swagger");
let TransactionsController = class TransactionsController {
    list;
    constructor(list) {
        this.list = list;
    }
    async listRoute(user, query) {
        const out = await this.list.execute({ userId: user?.sub ?? '', query });
        return out;
    }
};
exports.TransactionsController = TransactionsController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Listar transações' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: [{ id: 'uuid-trx-1', status: 'APROVADA', metodo: 'PIX', valor: 100 }],
                page: 1,
                pageSize: 20,
                total: 1,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['pageSize must not be greater than 100'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, list_transactions_query_dto_1.ListTransactionsQueryDto]),
    __metadata("design:returntype", Promise)
], TransactionsController.prototype, "listRoute", null);
exports.TransactionsController = TransactionsController = __decorate([
    (0, common_1.Controller)('transacoes'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Transações'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [list_transactions_use_case_1.ListTransactionsUseCase])
], TransactionsController);
//# sourceMappingURL=transactions.controller.js.map