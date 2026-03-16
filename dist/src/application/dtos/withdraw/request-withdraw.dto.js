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
exports.RequestWithdrawDto = void 0;
const class_validator_1 = require("class-validator");
class RequestWithdrawDto {
    valor;
    chavePix;
}
exports.RequestWithdrawDto = RequestWithdrawDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(100, { message: 'O valor mínimo para saque é de R$ 100,00' }),
    __metadata("design:type", Number)
], RequestWithdrawDto.prototype, "valor", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Matches)(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, {
        message: 'Chave PIX deve estar no formato CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)',
    }),
    __metadata("design:type", String)
], RequestWithdrawDto.prototype, "chavePix", void 0);
//# sourceMappingURL=request-withdraw.dto.js.map