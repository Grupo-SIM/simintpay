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
exports.CreatePlanUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const plan_repository_interface_1 = require("../../../core/repositories/plan.repository.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
function mapTipo(tipo) {
    switch (tipo) {
        case 'MENSAL':
            return { planType: client_1.PlanType.MONTHLY, frequency: 'MONTH' };
        case 'TRIMESTRAL':
            return { planType: client_1.PlanType.TRIMESTRAL, frequency: 'QUARTER' };
        case 'SEMESTRAL':
            return { planType: client_1.PlanType.SEMESTRAL, frequency: 'SEMESTER' };
        case 'ANUAL':
        default:
            return { planType: client_1.PlanType.ANUAL, frequency: 'YEAR' };
    }
}
let CreatePlanUseCase = class CreatePlanUseCase {
    users;
    plans;
    gateway;
    constructor(users, plans, gateway) {
        this.users = users;
        this.plans = plans;
        this.gateway = gateway;
    }
    async execute(input) {
        const user = await this.users.findById(input.userId);
        if (!user?.domToken) {
            throw new common_1.UnauthorizedException('Usuário não autenticado na api-dom');
        }
        const { planType, frequency } = mapTipo(input.dto.tipo);
        const dom = await this.gateway.createPlan(user.domToken, {
            price: input.dto.preco,
            description: `${input.dto.nome}${input.dto.descricao ? ` - ${input.dto.descricao}` : ''}`,
            frequency_type: frequency,
            webhookUrl: input.dto.webhookUrl,
            redirectUrl: input.dto.redirectUrl,
        });
        const saved = await this.plans.create({
            userId: input.userId,
            name: input.dto.nome,
            description: input.dto.descricao ?? null,
            price: input.dto.preco,
            type: planType,
            isActive: true,
            webhookUrl: input.dto.webhookUrl ?? null,
            redirectUrl: input.dto.redirectUrl ?? null,
            domPlanId: dom.id,
        });
        return {
            data: {
                id: saved.id,
                nome: saved.name,
                descricao: saved.description ?? null,
                preco: Number(saved.price),
                tipo: input.dto.tipo,
                ativo: saved.isActive,
                webhookUrl: saved.webhookUrl ?? null,
                redirectUrl: saved.redirectUrl ?? null,
                criadoEm: saved.createdAt.toISOString(),
            },
        };
    }
};
exports.CreatePlanUseCase = CreatePlanUseCase;
exports.CreatePlanUseCase = CreatePlanUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __param(1, (0, common_1.Inject)(plan_repository_interface_1.PLAN_REPOSITORY)),
    __param(2, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [Object, Object, Object])
], CreatePlanUseCase);
//# sourceMappingURL=create-plan.use-case.js.map