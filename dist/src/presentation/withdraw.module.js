"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WithdrawModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const withdraw_controller_1 = require("./controllers/withdraw.controller");
const withdraw_repository_interface_1 = require("../core/repositories/withdraw.repository.interface");
const prisma_withdraw_repository_1 = require("../infrastructure/database/repositories/prisma-withdraw.repository");
const balance_log_repository_interface_1 = require("../core/repositories/balance-log.repository.interface");
const prisma_balance_log_repository_1 = require("../infrastructure/database/repositories/prisma-balance-log.repository");
const request_withdraw_use_case_1 = require("../application/use-cases/withdraw/request-withdraw.use-case");
const list_withdrawals_use_case_1 = require("../application/use-cases/withdraw/list-withdrawals.use-case");
const check_pending_withdraw_use_case_1 = require("../application/use-cases/withdraw/check-pending-withdraw.use-case");
const cache_interface_1 = require("../core/services/cache.interface");
const noop_cache_service_1 = require("../infrastructure/cache/noop-cache.service");
let WithdrawModule = class WithdrawModule {
};
exports.WithdrawModule = WithdrawModule;
exports.WithdrawModule = WithdrawModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [withdraw_controller_1.WithdrawController],
        providers: [
            request_withdraw_use_case_1.RequestWithdrawUseCase,
            list_withdrawals_use_case_1.ListWithdrawalsUseCase,
            check_pending_withdraw_use_case_1.CheckPendingWithdrawUseCase,
            { provide: withdraw_repository_interface_1.WITHDRAW_REPOSITORY, useClass: prisma_withdraw_repository_1.PrismaWithdrawRepository },
            { provide: balance_log_repository_interface_1.BALANCE_LOG_REPOSITORY, useClass: prisma_balance_log_repository_1.PrismaBalanceLogRepository },
            { provide: cache_interface_1.CACHE_SERVICE, useClass: noop_cache_service_1.NoopCacheService },
        ],
    })
], WithdrawModule);
//# sourceMappingURL=withdraw.module.js.map