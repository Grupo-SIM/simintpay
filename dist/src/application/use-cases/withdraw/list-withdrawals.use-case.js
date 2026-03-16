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
exports.ListWithdrawalsUseCase = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const withdraw_repository_interface_1 = require("../../../core/repositories/withdraw.repository.interface");
function mapPtToInternal(status) {
    switch (status) {
        case 'PENDENTE':
            return client_1.WithdrawStatus.PENDING;
        case 'APROVADO':
            return client_1.WithdrawStatus.APPROVED;
        case 'PAGO':
            return client_1.WithdrawStatus.COMPLETED;
        case 'REJEITADO':
            return client_1.WithdrawStatus.REJECTED;
        default:
            return undefined;
    }
}
function mapInternalToPt(status) {
    switch (status) {
        case client_1.WithdrawStatus.PENDING:
            return 'PENDENTE';
        case client_1.WithdrawStatus.APPROVED:
            return 'APROVADO';
        case client_1.WithdrawStatus.COMPLETED:
            return 'PAGO';
        case client_1.WithdrawStatus.REJECTED:
        default:
            return 'REJEITADO';
    }
}
function toResponse(w) {
    return {
        id: w.id,
        valor: Number(w.amount),
        valorBruto: Number(w.grossAmount),
        taxa: Number(w.fee),
        status: mapInternalToPt(w.status),
        chavePix: w.pixKey,
        comprovante: w.receiptImage ?? null,
        motivoRejeicao: w.rejectionReason ?? null,
        criadoEm: w.createdAt.toISOString(),
        atualizadoEm: w.updatedAt.toISOString(),
        usuario: {
            nome: w.user.name,
            email: w.user.email,
        },
    };
}
let ListWithdrawalsUseCase = class ListWithdrawalsUseCase {
    withdraws;
    constructor(withdraws) {
        this.withdraws = withdraws;
    }
    async execute(input) {
        const page = input.query.page ?? 1;
        const pageSize = input.query.pageSize ?? 10;
        const dbStatus = input.query.status && input.query.status !== 'all'
            ? mapPtToInternal(input.query.status)
            : undefined;
        const { total, items } = await this.withdraws.findByUserId({
            userId: input.userId,
            page,
            pageSize,
            status: dbStatus,
        });
        return {
            data: items.map(toResponse),
            page,
            pageSize,
            total,
        };
    }
};
exports.ListWithdrawalsUseCase = ListWithdrawalsUseCase;
exports.ListWithdrawalsUseCase = ListWithdrawalsUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(withdraw_repository_interface_1.WITHDRAW_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], ListWithdrawalsUseCase);
//# sourceMappingURL=list-withdrawals.use-case.js.map