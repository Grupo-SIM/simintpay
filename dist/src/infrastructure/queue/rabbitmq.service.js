"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RabbitMqService = void 0;
const common_1 = require("@nestjs/common");
const amqp_connection_manager_1 = require("amqp-connection-manager");
let RabbitMqService = class RabbitMqService {
    connection = (0, amqp_connection_manager_1.connect)([
        process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
    ]);
    channel = this.connection.createChannel({
        setup: async (channel) => {
            await channel.prefetch(10);
        },
    });
    async publish(queue, message) {
        await this.channel.assertQueue(queue, { durable: true });
        const payload = Buffer.from(JSON.stringify(message));
        await this.channel.sendToQueue(queue, payload, { persistent: true });
    }
    async onModuleDestroy() {
        await this.channel.close();
        await this.connection.close();
    }
};
exports.RabbitMqService = RabbitMqService;
exports.RabbitMqService = RabbitMqService = __decorate([
    (0, common_1.Injectable)()
], RabbitMqService);
//# sourceMappingURL=rabbitmq.service.js.map