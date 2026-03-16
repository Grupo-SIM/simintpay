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
exports.CheckPendingWithdrawUseCase = void 0;
const common_1 = require("@nestjs/common");
const withdraw_repository_interface_1 = require("../../../core/repositories/withdraw.repository.interface");
let CheckPendingWithdrawUseCase = class CheckPendingWithdrawUseCase {
    withdraws;
    constructor(withdraws) {
        this.withdraws = withdraws;
    }
    async execute(userId) {
        const pending = await this.withdraws.findPendingByUserId(userId);
        return {
            temPendente: Boolean(pending),
            saquePendente: pending
                ? {
                    id: pending.id,
                    valor: Number(pending.amount),
                    valorBruto: Number(pending.grossAmount),
                    criadoEm: pending.createdAt.toISOString(),
                }
                : null,
        };
    }
};
exports.CheckPendingWithdrawUseCase = CheckPendingWithdrawUseCase;
exports.CheckPendingWithdrawUseCase = CheckPendingWithdrawUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(withdraw_repository_interface_1.WITHDRAW_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], CheckPendingWithdrawUseCase);
//# sourceMappingURL=check-pending-withdraw.use-case.js.map