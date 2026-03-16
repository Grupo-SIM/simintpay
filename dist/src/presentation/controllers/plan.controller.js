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
exports.PlanController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const create_plan_dto_1 = require("../../application/dtos/plan/create-plan.dto");
const create_plan_use_case_1 = require("../../application/use-cases/plan/create-plan.use-case");
const list_plans_use_case_1 = require("../../application/use-cases/plan/list-plans.use-case");
const delete_plan_use_case_1 = require("../../application/use-cases/plan/delete-plan.use-case");
const swagger_1 = require("@nestjs/swagger");
let PlanController = class PlanController {
    list;
    create;
    del;
    constructor(list, create, del) {
        this.list = list;
        this.create = create;
        this.del = del;
    }
    async listRoute(user) {
        return this.list.execute({ userId: user?.sub ?? '' });
    }
    async createRoute(user, dto) {
        return this.create.execute({ userId: user?.sub ?? '', dto });
    }
    async deleteRoute(user, id) {
        await this.del.execute({ userId: user?.sub ?? '', id });
        return { deleted: true };
    }
};
exports.PlanController = PlanController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Listar planos' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: [{ id: 'uuid-plan-1', description: 'Plano Mensal', price: 99.9 }] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlanController.prototype, "listRoute", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Criar plano' }),
    (0, swagger_1.ApiBody)({
        type: create_plan_dto_1.CreatePlanDto,
        examples: {
            default: {
                value: {
                    nome: 'Plano Mensal',
                    descricao: 'Assinatura mensal',
                    preco: 99.9,
                    tipo: 'MENSAL',
                    webhookUrl: 'https://exemplo.com/webhook',
                    redirectUrl: 'https://exemplo.com/obrigado',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 201, schema: { example: { data: { id: 'uuid-plan-1' } } } }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['tipo must be one of the following values: MENSAL, TRIMESTRAL, SEMESTRAL, ANUAL'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_plan_dto_1.CreatePlanDto]),
    __metadata("design:returntype", Promise)
], PlanController.prototype, "createRoute", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Remover plano' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { deleted: true } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    (0, swagger_1.ApiResponse)({ status: 404, schema: { example: { statusCode: 404, message: 'Plano não encontrado' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PlanController.prototype, "deleteRoute", null);
exports.PlanController = PlanController = __decorate([
    (0, common_1.Controller)('planos'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Planos'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [list_plans_use_case_1.ListPlansUseCase,
        create_plan_use_case_1.CreatePlanUseCase,
        delete_plan_use_case_1.DeletePlanUseCase])
], PlanController);
//# sourceMappingURL=plan.controller.js.map