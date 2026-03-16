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
exports.ListPlansUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const plan_repository_interface_1 = require("../../../core/repositories/plan.repository.interface");
function mapPlanTypeToPt(tipo) {
    switch (tipo) {
        case client_1.PlanType.MONTHLY:
            return 'MENSAL';
        case client_1.PlanType.TRIMESTRAL:
            return 'TRIMESTRAL';
        case client_1.PlanType.SEMESTRAL:
            return 'SEMESTRAL';
        case client_1.PlanType.ANUAL:
        default:
            return 'ANUAL';
    }
}
let ListPlansUseCase = class ListPlansUseCase {
    plans;
    constructor(plans) {
        this.plans = plans;
    }
    async execute(input) {
        const items = await this.plans.findManyByUserId(input.userId);
        return {
            data: items.map((p) => ({
                id: p.id,
                nome: p.name,
                descricao: p.description ?? null,
                preco: Number(p.price),
                tipo: mapPlanTypeToPt(p.type),
                ativo: p.isActive,
                webhookUrl: p.webhookUrl ?? null,
                redirectUrl: p.redirectUrl ?? null,
                criadoEm: p.createdAt.toISOString(),
            })),
        };
    }
};
exports.ListPlansUseCase = ListPlansUseCase;
exports.ListPlansUseCase = ListPlansUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(plan_repository_interface_1.PLAN_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], ListPlansUseCase);
//# sourceMappingURL=list-plans.use-case.js.map