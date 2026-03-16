"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeadModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const lead_controller_1 = require("./controllers/lead.controller");
const create_lead_use_case_1 = require("../application/use-cases/lead/create-lead.use-case");
let LeadModule = class LeadModule {
};
exports.LeadModule = LeadModule;
exports.LeadModule = LeadModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [lead_controller_1.LeadController],
        providers: [create_lead_use_case_1.CreateLeadUseCase],
    })
], LeadModule);
//# sourceMappingURL=lead.module.js.map