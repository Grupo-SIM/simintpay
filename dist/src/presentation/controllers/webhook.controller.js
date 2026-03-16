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
var WebhookController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookController = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const common_2 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const queue_interface_1 = require("../../core/services/queue.interface");
const queue_names_1 = require("../../infrastructure/queue/queue-names");
let WebhookController = WebhookController_1 = class WebhookController {
    queue;
    logger = new common_1.Logger(WebhookController_1.name);
    constructor(queue) {
        this.queue = queue;
    }
    async handle(body, signature, secretHeader, req) {
        const expectedSecret = process.env.WEBHOOK_SECRET;
        if (!expectedSecret) {
            this.logger.error('WEBHOOK_SECRET not configured');
            throw new common_1.UnauthorizedException('Webhook not configured');
        }
        if (!secretHeader || secretHeader !== expectedSecret) {
            throw new common_1.UnauthorizedException('Invalid webhook secret');
        }
        const raw = req.rawBody;
        if (!raw || !signature) {
            throw new common_1.UnauthorizedException('Missing signature or body');
        }
        const computed = (0, crypto_1.createHmac)('sha256', expectedSecret)
            .update(raw)
            .digest('hex');
        const a = Buffer.from(signature);
        const b = Buffer.from(computed);
        if (a.length !== b.length || !(0, crypto_1.timingSafeEqual)(a, b)) {
            throw new common_1.UnauthorizedException('Invalid webhook signature');
        }
        await this.queue.publish(queue_names_1.QueueNames.WEBHOOK_EVENTS, body);
        return { status: 'ok' };
    }
};
exports.WebhookController = WebhookController;
__decorate([
    (0, common_1.Post)('eventos'),
    (0, common_1.HttpCode)(200),
    (0, throttler_1.SkipThrottle)(),
    (0, swagger_1.ApiOperation)({ summary: 'Receber eventos de webhook' }),
    (0, swagger_1.ApiBody)({
        schema: {
            example: {
                type: 'payment.created',
                data: { id: 'uuid-event-1' },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { status: 'ok' } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Invalid webhook secret' } } }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('x-webhook-signature')),
    __param(2, (0, common_1.Headers)('x-webhook-secret')),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WebhookController.prototype, "handle", null);
exports.WebhookController = WebhookController = WebhookController_1 = __decorate([
    (0, common_1.Controller)('webhook'),
    (0, swagger_1.ApiTags)('Webhook'),
    __param(0, (0, common_2.Inject)(queue_interface_1.QUEUE_SERVICE)),
    __metadata("design:paramtypes", [Object])
], WebhookController);
//# sourceMappingURL=webhook.controller.js.map