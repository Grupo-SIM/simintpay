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
var WebhookConsumer_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookConsumer = void 0;
const common_1 = require("@nestjs/common");
const amqp_connection_manager_1 = require("amqp-connection-manager");
const queue_names_1 = require("../queue-names");
const process_webhook_use_case_1 = require("../../../application/use-cases/webhook/process-webhook.use-case");
let WebhookConsumer = WebhookConsumer_1 = class WebhookConsumer {
    processWebhook;
    logger = new common_1.Logger(WebhookConsumer_1.name);
    connection = null;
    constructor(processWebhook) {
        this.processWebhook = processWebhook;
    }
    onModuleInit() {
        this.connection = (0, amqp_connection_manager_1.connect)([
            process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
        ]);
        const channelWrapper = this.connection.createChannel({
            setup: async (channel) => {
                await channel.assertQueue(queue_names_1.QueueNames.WEBHOOK_EVENTS, { durable: true });
                await channel.prefetch(10);
                await channel.consume(queue_names_1.QueueNames.WEBHOOK_EVENTS, (msg) => {
                    if (!msg)
                        return;
                    void this.handleMessage(channel, msg);
                }, { noAck: false });
            },
        });
        void channelWrapper;
    }
    async onModuleDestroy() {
        if (this.connection) {
            await this.connection.close();
            this.logger.log('RabbitMQ consumer connection closed');
        }
    }
    async handleMessage(channel, msg) {
        try {
            const payload = JSON.parse(msg.content.toString());
            if (payload && typeof payload === 'object') {
                await this.processWebhook.execute({ payload });
            }
            channel.ack(msg);
        }
        catch (error) {
            this.logger.error(`Failed to process webhook message: ${error instanceof Error ? error.message : 'unknown error'}`);
            channel.nack(msg, false, false);
        }
    }
};
exports.WebhookConsumer = WebhookConsumer;
exports.WebhookConsumer = WebhookConsumer = WebhookConsumer_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [process_webhook_use_case_1.ProcessWebhookUseCase])
], WebhookConsumer);
//# sourceMappingURL=webhook.consumer.js.map