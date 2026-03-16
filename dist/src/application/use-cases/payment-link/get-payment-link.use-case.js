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
exports.GetPaymentLinkUseCase = void 0;
const common_1 = require("@nestjs/common");
const payment_link_repository_interface_1 = require("../../../core/repositories/payment-link.repository.interface");
let GetPaymentLinkUseCase = class GetPaymentLinkUseCase {
    links;
    constructor(links) {
        this.links = links;
    }
    async execute(input) {
        const link = await this.links.findByIdForUser({
            id: input.id,
            userId: input.userId,
        });
        if (!link)
            throw new common_1.NotFoundException('Link não encontrado');
        return {
            data: {
                id: link.id,
                codigo: link.code,
                titulo: link.title,
                descricao: link.description ?? null,
                valor: Number(link.amount),
                parcelasMax: link.maxInstallments,
                ativo: link.isActive,
                criadoEm: link.createdAt.toISOString(),
            },
        };
    }
};
exports.GetPaymentLinkUseCase = GetPaymentLinkUseCase;
exports.GetPaymentLinkUseCase = GetPaymentLinkUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(payment_link_repository_interface_1.PAYMENT_LINK_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], GetPaymentLinkUseCase);
//# sourceMappingURL=get-payment-link.use-case.js.map