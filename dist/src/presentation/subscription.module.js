"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const subscription_controller_1 = require("./controllers/subscription.controller");
const list_subscribers_use_case_1 = require("../application/use-cases/subscription/list-subscribers.use-case");
const cancel_subscription_use_case_1 = require("../application/use-cases/subscription/cancel-subscription.use-case");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
let SubscriptionModule = class SubscriptionModule {
};
exports.SubscriptionModule = SubscriptionModule;
exports.SubscriptionModule = SubscriptionModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [subscription_controller_1.SubscriptionController],
        providers: [
            list_subscribers_use_case_1.ListSubscribersUseCase,
            cancel_subscription_use_case_1.CancelSubscriptionUseCase,
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
        ],
    })
], SubscriptionModule);
//# sourceMappingURL=subscription.module.js.map