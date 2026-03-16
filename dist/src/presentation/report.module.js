"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const report_controller_1 = require("./controllers/report.controller");
const dashboard_summary_use_case_1 = require("../application/use-cases/report/dashboard-summary.use-case");
const monthly_revenue_use_case_1 = require("../application/use-cases/report/monthly-revenue.use-case");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
let ReportModule = class ReportModule {
};
exports.ReportModule = ReportModule;
exports.ReportModule = ReportModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [report_controller_1.ReportController],
        providers: [
            dashboard_summary_use_case_1.DashboardSummaryUseCase,
            monthly_revenue_use_case_1.MonthlyRevenueUseCase,
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
        ],
    })
], ReportModule);
//# sourceMappingURL=report.module.js.map