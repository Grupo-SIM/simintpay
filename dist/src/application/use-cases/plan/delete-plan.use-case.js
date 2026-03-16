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
exports.DeletePlanUseCase = void 0;
const common_1 = require("@nestjs/common");
const plan_repository_interface_1 = require("../../../core/repositories/plan.repository.interface");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
let DeletePlanUseCase = class DeletePlanUseCase {
    users;
    plans;
    gateway;
    constructor(users, plans, gateway) {
        this.users = users;
        this.plans = plans;
        this.gateway = gateway;
    }
    async execute(input) {
        const plan = await this.plans.findByIdForUser({
            id: input.id,
            userId: input.userId,
        });
        if (!plan)
            throw new common_1.NotFoundException('Plano não encontrado');
        const user = await this.users.findById(input.userId);
        if (!user?.domToken) {
            throw new common_1.UnauthorizedException('Usuário não autenticado na api-dom');
        }
        if (plan.domPlanId) {
            await this.gateway.deletePlan(user.domToken, plan.domPlanId);
        }
        await this.plans.delete(plan.id);
    }
};
exports.DeletePlanUseCase = DeletePlanUseCase;
exports.DeletePlanUseCase = DeletePlanUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __param(1, (0, common_1.Inject)(plan_repository_interface_1.PLAN_REPOSITORY)),
    __param(2, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [Object, Object, Object])
], DeletePlanUseCase);
//# sourceMappingURL=delete-plan.use-case.js.map