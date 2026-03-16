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
exports.LeadController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const throttler_1 = require("@nestjs/throttler");
const create_lead_dto_1 = require("../../application/dtos/lead/create-lead.dto");
const create_lead_use_case_1 = require("../../application/use-cases/lead/create-lead.use-case");
const request_utils_1 = require("../../shared/utils/request.utils");
let LeadController = class LeadController {
    createLead;
    constructor(createLead) {
        this.createLead = createLead;
    }
    async create(dto, req) {
        const ip = (0, request_utils_1.getRequestIp)(req) ?? req.ip ?? 'unknown';
        return this.createLead.execute(dto);
    }
};
exports.LeadController = LeadController;
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(201),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60000 } }),
    (0, swagger_1.ApiOperation)({ summary: 'Enviar solicitação de cadastro (público, sem auth)' }),
    (0, swagger_1.ApiBody)({
        type: create_lead_dto_1.CreateLeadDto,
        examples: {
            default: {
                value: {
                    name: 'João Silva',
                    phone: '(11) 99999-9999',
                    email: 'joao@empresa.com',
                    razaoSocial: 'Empresa LTDA',
                    cnpj: '12.345.678/0001-90',
                    faturamento: 'DE_50K_A_100K',
                    tempoOperacao: 'DE_1_A_3_ANOS',
                    modeloOperacao: 'ECOMMERCE',
                    cargo: 'SOCIO',
                    comoConheceu: 'Google',
                },
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        schema: {
            example: {
                data: { id: 'uuid-lead-1' },
                message: 'Solicitação enviada com sucesso! Entraremos em contato em breve.',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        schema: {
            example: {
                statusCode: 400,
                message: ['email must be an email'],
                error: 'Bad Request',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        schema: {
            example: {
                statusCode: 409,
                message: 'Já existe uma solicitação pendente com este e-mail',
            },
        },
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_lead_dto_1.CreateLeadDto, Object]),
    __metadata("design:returntype", Promise)
], LeadController.prototype, "create", null);
exports.LeadController = LeadController = __decorate([
    (0, swagger_1.ApiTags)('Leads (Solicitações de Cadastro)'),
    (0, common_1.Controller)('leads'),
    __metadata("design:paramtypes", [create_lead_use_case_1.CreateLeadUseCase])
], LeadController);
//# sourceMappingURL=lead.controller.js.map