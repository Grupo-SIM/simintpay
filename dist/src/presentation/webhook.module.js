"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookModule = void 0;
const common_1 = require("@nestjs/common");
const webhook_controller_1 = require("./controllers/webhook.controller");
const rabbitmq_module_1 = require("../infrastructure/queue/rabbitmq.module");
const webhook_consumer_1 = require("../infrastructure/queue/consumers/webhook.consumer");
const process_webhook_use_case_1 = require("../application/use-cases/webhook/process-webhook.use-case");
const webhook_event_repository_interface_1 = require("../core/repositories/webhook-event.repository.interface");
const prisma_webhook_event_repository_1 = require("../infrastructure/database/repositories/prisma-webhook-event.repository");
const transaction_repository_interface_1 = require("../core/repositories/transaction.repository.interface");
const prisma_transaction_repository_1 = require("../infrastructure/database/repositories/prisma-transaction.repository");
const balance_log_repository_interface_1 = require("../core/repositories/balance-log.repository.interface");
const prisma_balance_log_repository_1 = require("../infrastructure/database/repositories/prisma-balance-log.repository");
let WebhookModule = class WebhookModule {
};
exports.WebhookModule = WebhookModule;
exports.WebhookModule = WebhookModule = __decorate([
    (0, common_1.Module)({
        imports: [rabbitmq_module_1.RabbitMqModule],
        controllers: [webhook_controller_1.WebhookController],
        providers: [
            process_webhook_use_case_1.ProcessWebhookUseCase,
            webhook_consumer_1.WebhookConsumer,
            {
                provide: webhook_event_repository_interface_1.WEBHOOK_EVENT_REPOSITORY,
                useClass: prisma_webhook_event_repository_1.PrismaWebhookEventRepository,
            },
            { provide: transaction_repository_interface_1.TRANSACTION_REPOSITORY, useClass: prisma_transaction_repository_1.PrismaTransactionRepository },
            { provide: balance_log_repository_interface_1.BALANCE_LOG_REPOSITORY, useClass: prisma_balance_log_repository_1.PrismaBalanceLogRepository },
        ],
    })
], WebhookModule);
//# sourceMappingURL=webhook.module.js.map