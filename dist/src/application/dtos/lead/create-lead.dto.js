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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateLeadDto = exports.CargoEmpresa = exports.ModeloOperacao = exports.TempoOperacao = exports.Faturamento = void 0;
const class_validator_1 = require("class-validator");
const swagger_1 = require("@nestjs/swagger");
var Faturamento;
(function (Faturamento) {
    Faturamento["ATE_10K"] = "ATE_10K";
    Faturamento["DE_10K_A_50K"] = "DE_10K_A_50K";
    Faturamento["DE_50K_A_100K"] = "DE_50K_A_100K";
    Faturamento["DE_100K_A_500K"] = "DE_100K_A_500K";
    Faturamento["ACIMA_500K"] = "ACIMA_500K";
})(Faturamento || (exports.Faturamento = Faturamento = {}));
var TempoOperacao;
(function (TempoOperacao) {
    TempoOperacao["MENOS_1_ANO"] = "MENOS_1_ANO";
    TempoOperacao["DE_1_A_3_ANOS"] = "DE_1_A_3_ANOS";
    TempoOperacao["DE_3_A_5_ANOS"] = "DE_3_A_5_ANOS";
    TempoOperacao["MAIS_5_ANOS"] = "MAIS_5_ANOS";
})(TempoOperacao || (exports.TempoOperacao = TempoOperacao = {}));
var ModeloOperacao;
(function (ModeloOperacao) {
    ModeloOperacao["ECOMMERCE"] = "ECOMMERCE";
    ModeloOperacao["PRESENCIAL"] = "PRESENCIAL";
    ModeloOperacao["AMBOS"] = "AMBOS";
    ModeloOperacao["SERVICOS"] = "SERVICOS";
    ModeloOperacao["ASSINATURAS"] = "ASSINATURAS";
})(ModeloOperacao || (exports.ModeloOperacao = ModeloOperacao = {}));
var CargoEmpresa;
(function (CargoEmpresa) {
    CargoEmpresa["SOCIO"] = "SOCIO";
    CargoEmpresa["DIRETOR"] = "DIRETOR";
    CargoEmpresa["GERENTE"] = "GERENTE";
    CargoEmpresa["FINANCEIRO"] = "FINANCEIRO";
    CargoEmpresa["TI"] = "TI";
    CargoEmpresa["OUTRO"] = "OUTRO";
})(CargoEmpresa || (exports.CargoEmpresa = CargoEmpresa = {}));
class CreateLeadDto {
    name;
    phone;
    email;
    razaoSocial;
    cnpj;
    faturamento;
    tempoOperacao;
    modeloOperacao;
    cargo;
    comoConheceu;
}
exports.CreateLeadDto = CreateLeadDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'João Silva' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '(11) 99999-9999' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "phone", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'joao@empresa.com' }),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Empresa LTDA' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "razaoSocial", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '12.345.678/0001-90' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ inválido' }),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "cnpj", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: Faturamento, example: Faturamento.DE_50K_A_100K }),
    (0, class_validator_1.IsEnum)(Faturamento),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "faturamento", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: TempoOperacao, example: TempoOperacao.DE_1_A_3_ANOS }),
    (0, class_validator_1.IsEnum)(TempoOperacao),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "tempoOperacao", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ enum: ModeloOperacao, example: ModeloOperacao.ECOMMERCE }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(ModeloOperacao),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "modeloOperacao", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: CargoEmpresa, example: CargoEmpresa.SOCIO }),
    (0, class_validator_1.IsEnum)(CargoEmpresa),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "cargo", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ example: 'Google' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateLeadDto.prototype, "comoConheceu", void 0);
//# sourceMappingURL=create-lead.dto.js.map