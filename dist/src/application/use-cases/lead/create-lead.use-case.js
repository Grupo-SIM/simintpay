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
exports.CreateLeadUseCase = void 0;
const common_1 = require("@nestjs/common");
const lead_repository_interface_1 = require("../../../core/repositories/lead.repository.interface");
let CreateLeadUseCase = class CreateLeadUseCase {
    leads;
    constructor(leads) {
        this.leads = leads;
    }
    async execute(dto) {
        const existing = await this.leads.findByEmailOrCnpj(dto.email, dto.cnpj);
        if (existing && existing.status !== 'REJECTED') {
            throw new common_1.ConflictException('Já existe uma solicitação pendente com este e-mail ou CNPJ');
        }
        const lead = await this.leads.create({
            name: dto.name,
            phone: dto.phone,
            email: dto.email,
            razaoSocial: dto.razaoSocial,
            cnpj: dto.cnpj,
            faturamento: dto.faturamento,
            tempoOperacao: dto.tempoOperacao,
            modeloOperacao: dto.modeloOperacao,
            cargo: dto.cargo,
            comoConheceu: dto.comoConheceu,
        });
        return {
            data: { id: lead.id },
            message: 'Solicitação enviada com sucesso! Entraremos em contato em breve.',
        };
    }
};
exports.CreateLeadUseCase = CreateLeadUseCase;
exports.CreateLeadUseCase = CreateLeadUseCase = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(lead_repository_interface_1.LEAD_REPOSITORY)),
    __metadata("design:paramtypes", [Object])
], CreateLeadUseCase);
//# sourceMappingURL=create-lead.use-case.js.map