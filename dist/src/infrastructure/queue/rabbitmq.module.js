"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RabbitMqModule = void 0;
const common_1 = require("@nestjs/common");
const queue_interface_1 = require("../../core/services/queue.interface");
const rabbitmq_service_1 = require("./rabbitmq.service");
let RabbitMqModule = class RabbitMqModule {
};
exports.RabbitMqModule = RabbitMqModule;
exports.RabbitMqModule = RabbitMqModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [{ provide: queue_interface_1.QUEUE_SERVICE, useClass: rabbitmq_service_1.RabbitMqService }],
        exports: [queue_interface_1.QUEUE_SERVICE],
    })
], RabbitMqModule);
//# sourceMappingURL=rabbitmq.module.js.map