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
exports.ReportController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const dashboard_summary_use_case_1 = require("../../application/use-cases/report/dashboard-summary.use-case");
const monthly_revenue_use_case_1 = require("../../application/use-cases/report/monthly-revenue.use-case");
const swagger_1 = require("@nestjs/swagger");
let ReportController = class ReportController {
    dashboard;
    monthly;
    constructor(dashboard, monthly) {
        this.dashboard = dashboard;
        this.monthly = monthly;
    }
    async dashboardRoute(user) {
        return this.dashboard.execute({ userId: user?.sub ?? '' });
    }
    async monthlyRoute(user) {
        return this.monthly.execute({ userId: user?.sub ?? '' });
    }
};
exports.ReportController = ReportController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Resumo do dashboard' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { total: 1000, count: 10 } } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportController.prototype, "dashboardRoute", null);
__decorate([
    (0, common_1.Get)('receita-mensal'),
    (0, swagger_1.ApiOperation)({ summary: 'Receita mensal' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { items: [{ date: '2026-01', value: 1000 }] } } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportController.prototype, "monthlyRoute", null);
exports.ReportController = ReportController = __decorate([
    (0, common_1.Controller)('relatorios'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Relatórios'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [dashboard_summary_use_case_1.DashboardSummaryUseCase,
        monthly_revenue_use_case_1.MonthlyRevenueUseCase])
], ReportController);
//# sourceMappingURL=report.controller.js.map