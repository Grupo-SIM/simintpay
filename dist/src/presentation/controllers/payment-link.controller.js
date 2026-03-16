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
exports.PaymentLinkController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const create_payment_link_dto_1 = require("../../application/dtos/payment-link/create-payment-link.dto");
const update_payment_link_dto_1 = require("../../application/dtos/payment-link/update-payment-link.dto");
const list_payment_links_query_dto_1 = require("../../application/dtos/payment-link/list-payment-links.query.dto");
const create_payment_link_use_case_1 = require("../../application/use-cases/payment-link/create-payment-link.use-case");
const list_payment_links_use_case_1 = require("../../application/use-cases/payment-link/list-payment-links.use-case");
const get_payment_link_use_case_1 = require("../../application/use-cases/payment-link/get-payment-link.use-case");
const update_payment_link_use_case_1 = require("../../application/use-cases/payment-link/update-payment-link.use-case");
const delete_payment_link_use_case_1 = require("../../application/use-cases/payment-link/delete-payment-link.use-case");
const swagger_1 = require("@nestjs/swagger");
let PaymentLinkController = class PaymentLinkController {
    create;
    list;
    getOne;
    update;
    del;
    constructor(create, list, getOne, update, del) {
        this.create = create;
        this.list = list;
        this.getOne = getOne;
        this.update = update;
        this.del = del;
    }
    async listRoute(user, query) {
        return this.list.execute({ userId: user?.sub ?? '', query });
    }
    async createRoute(user, dto) {
        return this.create.execute({ userId: user?.sub ?? '', dto });
    }
    async getRoute(user, id) {
        return this.getOne.execute({ userId: user?.sub ?? '', id });
    }
    async updateRoute(user, id, dto) {
        return this.update.execute({ userId: user?.sub ?? '', id, dto });
    }
    async deleteRoute(user, id) {
        await this.del.execute({ userId: user?.sub ?? '', id });
        return { deleted: true };
    }
};
exports.PaymentLinkController = PaymentLinkController;
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Listar links de pagamento' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: {
            example: {
                data: [{ id: 'uuid-link-1', title: 'Plano Mensal', amount: 9900 }],
                page: 1,
                pageSize: 10,
                total: 1,
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Unauthorized' } },
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, list_payment_links_query_dto_1.ListPaymentLinksQueryDto]),
    __metadata("design:returntype", Promise)
], PaymentLinkController.prototype, "listRoute", null);
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Criar link de pagamento' }),
    (0, swagger_1.ApiBody)({
        type: create_payment_link_dto_1.CreatePaymentLinkDto,
        examples: {
            default: {
                value: {
                    titulo: 'Plano Mensal',
                    descricao: 'Assinatura mensal',
                    valor: 99.9,
                    parcelasMax: 12,
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        schema: { example: { data: { id: 'uuid-link-1' } } },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        schema: {
            example: { statusCode: 400, message: ['valor must be a number conforming to the specified constraints'] },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 401,
        schema: { example: { statusCode: 401, message: 'Unauthorized' } },
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_payment_link_dto_1.CreatePaymentLinkDto]),
    __metadata("design:returntype", Promise)
], PaymentLinkController.prototype, "createRoute", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Buscar link de pagamento por id' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: { example: { data: { id: 'uuid-link-1', title: 'Plano Mensal', amount: 9900 } } },
    }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    (0, swagger_1.ApiResponse)({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PaymentLinkController.prototype, "getRoute", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Atualizar link de pagamento' }),
    (0, swagger_1.ApiBody)({
        type: update_payment_link_dto_1.UpdatePaymentLinkDto,
        examples: {
            default: {
                value: {
                    titulo: 'Plano Mensal (Atualizado)',
                    valor: 109.9,
                    parcelasMax: 10,
                    isActive: true,
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { id: 'uuid-link-1' } } } }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['parcelasMax must not be greater than 12'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    (0, swagger_1.ApiResponse)({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, update_payment_link_dto_1.UpdatePaymentLinkDto]),
    __metadata("design:returntype", Promise)
], PaymentLinkController.prototype, "updateRoute", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Remover link de pagamento' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { deleted: true } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    (0, swagger_1.ApiResponse)({ status: 404, schema: { example: { statusCode: 404, message: 'Link não encontrado' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], PaymentLinkController.prototype, "deleteRoute", null);
exports.PaymentLinkController = PaymentLinkController = __decorate([
    (0, common_1.Controller)('links-pagamento'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Links de Pagamento'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [create_payment_link_use_case_1.CreatePaymentLinkUseCase,
        list_payment_links_use_case_1.ListPaymentLinksUseCase,
        get_payment_link_use_case_1.GetPaymentLinkUseCase,
        update_payment_link_use_case_1.UpdatePaymentLinkUseCase,
        delete_payment_link_use_case_1.DeletePaymentLinkUseCase])
], PaymentLinkController);
//# sourceMappingURL=payment-link.controller.js.map