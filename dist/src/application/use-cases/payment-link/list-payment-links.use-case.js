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
exports.ListPaymentLinksUseCase = void 0;
const common_1 = require("@nestjs/common");
const payment_link_repository_interface_1 = require("../../../core/repositories/payment-link.repository.interface");
let ListPaymentLinksUseCase = class ListPaymentLinksUseCase {
    links;
    constructor(links) {
        this.links = links;
    }
    async execute(input) {
        const page = input.query.page ?? 1;
        const pageSize = input.query.pageSize ?? 20;
        const { total, items } = await this.links.findManyByUserId({
            userId: input.userId,
            page,
            pageSize,
        });
        return {
            data: items.map((l) => ({
                id: l.id,
                codigo: l.code,
                titulo: l.title,
                descricao: l.description ?? null,
                valor: Number(l.amount),
                parcelasMax: l.maxInstallments,
                ativo: l.isActive,
                criadoEm: l.createdAt.toISOString(),
            })),
            page,
            pageSize,
            total,
        };
    }
};
exports.ListPaymentLinksUseCase = ListPaymentLinksUseCase;
exports.ListPaymentLinksUseCase = ListPaymentLinksUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(payment_link_repository_interface_1.PAYMENT_LINK_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], ListPaymentLinksUseCase);
//# sourceMappingURL=list-payment-links.use-case.js.map