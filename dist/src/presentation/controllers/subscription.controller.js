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
exports.SubscriptionController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const list_subscribers_query_dto_1 = require("../../application/dtos/subscription/list-subscribers.query.dto");
const list_subscribers_use_case_1 = require("../../application/use-cases/subscription/list-subscribers.use-case");
const cancel_subscription_use_case_1 = require("../../application/use-cases/subscription/cancel-subscription.use-case");
const swagger_1 = require("@nestjs/swagger");
let SubscriptionController = class SubscriptionController {
    listSubscribers;
    cancel;
    constructor(listSubscribers, cancel) {
        this.listSubscribers = listSubscribers;
        this.cancel = cancel;
    }
    async listSubscribersRoute(user, query) {
        return this.listSubscribers.execute({ userId: user?.sub ?? '', query });
    }
    async cancelRoute(user, id) {
        await this.cancel.execute({ userId: user?.sub ?? '', id });
        return { cancelled: true };
    }
};
exports.SubscriptionController = SubscriptionController;
__decorate([
    (0, common_1.Get)('assinantes'),
    (0, swagger_1.ApiOperation)({ summary: 'Listar assinantes' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: [{ id: 'uuid-sub-1', status: 'ACTIVE', planoId: 'uuid-plan-1' }],
                page: 1,
                pageSize: 20,
                total: 1,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['page must not be less than 1'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, list_subscribers_query_dto_1.ListSubscribersQueryDto]),
    __metadata("design:returntype", Promise)
], SubscriptionController.prototype, "listSubscribersRoute", null);
__decorate([
    (0, common_1.Put)('subscription/:id/cancel'),
    (0, swagger_1.ApiOperation)({ summary: 'Cancelar assinatura' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { cancelled: true } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    (0, swagger_1.ApiResponse)({ status: 404, schema: { example: { statusCode: 404, message: 'Assinatura não encontrada' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], SubscriptionController.prototype, "cancelRoute", null);
exports.SubscriptionController = SubscriptionController = __decorate([
    (0, common_1.Controller)('assinantes'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Assinantes'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [list_subscribers_use_case_1.ListSubscribersUseCase,
        cancel_subscription_use_case_1.CancelSubscriptionUseCase])
], SubscriptionController);
//# sourceMappingURL=subscription.controller.js.map