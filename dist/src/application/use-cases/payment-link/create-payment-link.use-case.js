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
exports.CreatePaymentLinkUseCase = void 0;
const common_1 = require("@nestjs/common");
const user_repository_interface_1 = require("../../../core/repositories/user.repository.interface");
const payment_link_repository_interface_1 = require("../../../core/repositories/payment-link.repository.interface");
const payment_gateway_interface_1 = require("../../../core/services/payment-gateway.interface");
let CreatePaymentLinkUseCase = class CreatePaymentLinkUseCase {
    users;
    links;
    gateway;
    constructor(users, links, gateway) {
        this.users = users;
        this.links = links;
        this.gateway = gateway;
    }
    async execute(input) {
        const user = await this.users.findById(input.userId);
        if (!user?.domToken) {
            throw new common_1.UnauthorizedException('Usuário não autenticado na api-dom');
        }
        const created = await this.gateway.createPaymentLink(user.domToken, {
            title: input.dto.titulo,
            description: input.dto.descricao ?? null,
            amount: input.dto.valor,
            maxInstallments: input.dto.parcelasMax ?? 1,
        });
        const saved = await this.links.create({
            userId: input.userId,
            title: input.dto.titulo,
            description: input.dto.descricao ?? null,
            amount: input.dto.valor,
            maxInstallments: input.dto.parcelasMax ?? 1,
            isActive: true,
            domPaymentLinkId: created.id,
        });
        return {
            data: {
                id: saved.id,
                codigo: saved.code,
                titulo: saved.title,
                descricao: saved.description ?? null,
                valor: Number(saved.amount),
                parcelasMax: saved.maxInstallments,
                ativo: saved.isActive,
                criadoEm: saved.createdAt.toISOString(),
            },
        };
    }
};
exports.CreatePaymentLinkUseCase = CreatePaymentLinkUseCase;
exports.CreatePaymentLinkUseCase = CreatePaymentLinkUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(user_repository_interface_1.USER_REPOSITORY)),
    __param(1, (0, common_1.Inject)(payment_link_repository_interface_1.PAYMENT_LINK_REPOSITORY)),
    __param(2, (0, common_1.Inject)(payment_gateway_interface_1.PAYMENT_GATEWAY)),
    __metadata("design:paramtypes", [Object, Object, Object])
], CreatePaymentLinkUseCase);
//# sourceMappingURL=create-payment-link.use-case.js.map