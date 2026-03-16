"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const settings_controller_1 = require("./controllers/settings.controller");
const get_profile_use_case_1 = require("../application/use-cases/settings/get-profile.use-case");
const update_profile_use_case_1 = require("../application/use-cases/settings/update-profile.use-case");
const get_email_settings_use_case_1 = require("../application/use-cases/settings/get-email-settings.use-case");
const update_email_settings_use_case_1 = require("../application/use-cases/settings/update-email-settings.use-case");
const get_taxes_use_case_1 = require("../application/use-cases/settings/get-taxes.use-case");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
let SettingsModule = class SettingsModule {
};
exports.SettingsModule = SettingsModule;
exports.SettingsModule = SettingsModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [settings_controller_1.SettingsController],
        providers: [
            get_profile_use_case_1.GetProfileUseCase,
            update_profile_use_case_1.UpdateProfileUseCase,
            get_email_settings_use_case_1.GetEmailSettingsUseCase,
            update_email_settings_use_case_1.UpdateEmailSettingsUseCase,
            get_taxes_use_case_1.GetTaxesUseCase,
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
        ],
    })
], SettingsModule);
//# sourceMappingURL=settings.module.js.map