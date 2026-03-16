"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentLinkModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const payment_link_controller_1 = require("./controllers/payment-link.controller");
const create_payment_link_use_case_1 = require("../application/use-cases/payment-link/create-payment-link.use-case");
const list_payment_links_use_case_1 = require("../application/use-cases/payment-link/list-payment-links.use-case");
const get_payment_link_use_case_1 = require("../application/use-cases/payment-link/get-payment-link.use-case");
const update_payment_link_use_case_1 = require("../application/use-cases/payment-link/update-payment-link.use-case");
const delete_payment_link_use_case_1 = require("../application/use-cases/payment-link/delete-payment-link.use-case");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
const payment_link_repository_interface_1 = require("../core/repositories/payment-link.repository.interface");
const prisma_payment_link_repository_1 = require("../infrastructure/database/repositories/prisma-payment-link.repository");
let PaymentLinkModule = class PaymentLinkModule {
};
exports.PaymentLinkModule = PaymentLinkModule;
exports.PaymentLinkModule = PaymentLinkModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [payment_link_controller_1.PaymentLinkController],
        providers: [
            create_payment_link_use_case_1.CreatePaymentLinkUseCase,
            list_payment_links_use_case_1.ListPaymentLinksUseCase,
            get_payment_link_use_case_1.GetPaymentLinkUseCase,
            update_payment_link_use_case_1.UpdatePaymentLinkUseCase,
            delete_payment_link_use_case_1.DeletePaymentLinkUseCase,
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
            { provide: payment_link_repository_interface_1.PAYMENT_LINK_REPOSITORY, useClass: prisma_payment_link_repository_1.PrismaPaymentLinkRepository },
        ],
    })
], PaymentLinkModule);
//# sourceMappingURL=payment-link.module.js.map