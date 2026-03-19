"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const throttler_1 = require("@nestjs/throttler");
const core_1 = require("@nestjs/core");
const prisma_module_1 = require("./infrastructure/database/prisma/prisma.module");
const auth_module_1 = require("./presentation/auth.module");
const webhook_module_1 = require("./presentation/webhook.module");
const rabbitmq_module_1 = require("./infrastructure/queue/rabbitmq.module");
const transactions_module_1 = require("./presentation/transactions.module");
const payment_link_module_1 = require("./presentation/payment-link.module");
const plan_module_1 = require("./presentation/plan.module");
const subscription_module_1 = require("./presentation/subscription.module");
const report_module_1 = require("./presentation/report.module");
const settings_module_1 = require("./presentation/settings.module");
const withdraw_module_1 = require("./presentation/withdraw.module");
const lead_module_1 = require("./presentation/lead.module");
const admin_module_1 = require("./presentation/admin.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            throttler_1.ThrottlerModule.forRoot({
                throttlers: [
                    {
                        name: 'default',
                        ttl: 60000,
                        limit: 60,
                    },
                ],
            }),
            prisma_module_1.PrismaModule,
            rabbitmq_module_1.RabbitMqModule,
            auth_module_1.AuthModule,
            webhook_module_1.WebhookModule,
            transactions_module_1.TransactionsModule,
            payment_link_module_1.PaymentLinkModule,
            plan_module_1.PlanModule,
            subscription_module_1.SubscriptionModule,
            report_module_1.ReportModule,
            settings_module_1.SettingsModule,
            withdraw_module_1.WithdrawModule,
            lead_module_1.LeadModule,
            admin_module_1.AdminModule,
        ],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map