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
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../../infrastructure/security/guards/jwt-auth.guard");
const current_user_decorator_1 = require("../../infrastructure/security/decorators/current-user.decorator");
const update_profile_dto_1 = require("../../application/dtos/settings/update-profile.dto");
const update_email_settings_dto_1 = require("../../application/dtos/settings/update-email-settings.dto");
const get_profile_use_case_1 = require("../../application/use-cases/settings/get-profile.use-case");
const update_profile_use_case_1 = require("../../application/use-cases/settings/update-profile.use-case");
const get_email_settings_use_case_1 = require("../../application/use-cases/settings/get-email-settings.use-case");
const update_email_settings_use_case_1 = require("../../application/use-cases/settings/update-email-settings.use-case");
const get_taxes_use_case_1 = require("../../application/use-cases/settings/get-taxes.use-case");
const change_password_use_case_1 = require("../../application/use-cases/settings/change-password.use-case");
const change_password_dto_1 = require("../../application/dtos/settings/change-password.dto");
const swagger_1 = require("@nestjs/swagger");
let SettingsController = class SettingsController {
    getProfile;
    updateProfile;
    getEmail;
    updateEmail;
    taxes;
    changePassword;
    constructor(getProfile, updateProfile, getEmail, updateEmail, taxes, changePassword) {
        this.getProfile = getProfile;
        this.updateProfile = updateProfile;
        this.getEmail = getEmail;
        this.updateEmail = updateEmail;
        this.taxes = taxes;
        this.changePassword = changePassword;
    }
    async profileRoute(user) {
        return this.getProfile.execute({ userId: user?.sub ?? '' });
    }
    async updateProfileRoute(user, dto) {
        return this.updateProfile.execute({ userId: user?.sub ?? '', dto });
    }
    async taxesRoute(user) {
        return this.taxes.execute({ userId: user?.sub ?? '' });
    }
    async emailRoute(user) {
        return this.getEmail.execute({ userId: user?.sub ?? '' });
    }
    async changePasswordRoute(user, dto) {
        return this.changePassword.execute({ userId: user?.sub ?? '', dto });
    }
    async updateEmailRoute(user, dto) {
        return this.updateEmail.execute({ userId: user?.sub ?? '', dto });
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)('perfil'),
    (0, swagger_1.ApiOperation)({ summary: 'Obter perfil' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { nome: 'João', email: 'joao@empresa.com' } } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "profileRoute", null);
__decorate([
    (0, common_1.Put)('perfil'),
    (0, swagger_1.ApiOperation)({ summary: 'Atualizar perfil' }),
    (0, swagger_1.ApiBody)({
        type: update_profile_dto_1.UpdateProfileDto,
        examples: {
            default: { value: { nome: 'João Silva', email: 'joao@empresa.com' } },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { updated: true } } } }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['email must be an email'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_profile_dto_1.UpdateProfileDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateProfileRoute", null);
__decorate([
    (0, common_1.Get)('taxas'),
    (0, swagger_1.ApiOperation)({ summary: 'Obter taxas' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        schema: { example: { data: { pix: { percentual: 1.99, fixo: 0.5 } } } },
    }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "taxesRoute", null);
__decorate([
    (0, common_1.Get)('email'),
    (0, swagger_1.ApiOperation)({ summary: 'Obter configurações de e-mail' }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { emailNotifications: true } } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "emailRoute", null);
__decorate([
    (0, common_1.Put)('senha'),
    (0, swagger_1.ApiOperation)({ summary: 'Alterar senha' }),
    (0, swagger_1.ApiBody)({
        type: change_password_dto_1.ChangePasswordDto,
        examples: {
            default: { value: { currentPassword: 'senha-atual', newPassword: 'nova-senha' } },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { updated: true } } } }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: 'Senha atual incorreta' } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, change_password_dto_1.ChangePasswordDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "changePasswordRoute", null);
__decorate([
    (0, common_1.Put)('email'),
    (0, swagger_1.ApiOperation)({ summary: 'Atualizar configurações de e-mail' }),
    (0, swagger_1.ApiBody)({
        type: update_email_settings_dto_1.UpdateEmailSettingsDto,
        examples: {
            default: { value: { emailNotifications: true } },
        },
    }),
    (0, swagger_1.ApiResponse)({ status: 200, schema: { example: { data: { updated: true } } } }),
    (0, swagger_1.ApiResponse)({ status: 400, schema: { example: { statusCode: 400, message: ['emailNotifications must be a boolean value'] } } }),
    (0, swagger_1.ApiResponse)({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, update_email_settings_dto_1.UpdateEmailSettingsDto]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "updateEmailRoute", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('configuracoes'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiTags)('Configurações'),
    (0, swagger_1.ApiBearerAuth)(),
    __metadata("design:paramtypes", [get_profile_use_case_1.GetProfileUseCase,
        update_profile_use_case_1.UpdateProfileUseCase,
        get_email_settings_use_case_1.GetEmailSettingsUseCase,
        update_email_settings_use_case_1.UpdateEmailSettingsUseCase,
        get_taxes_use_case_1.GetTaxesUseCase,
        change_password_use_case_1.ChangePasswordUseCase])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map