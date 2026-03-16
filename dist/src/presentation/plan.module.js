"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanModule = void 0;
const common_1 = require("@nestjs/common");
const api_dom_module_1 = require("../infrastructure/http/api-dom.module");
const plan_controller_1 = require("./controllers/plan.controller");
const create_plan_use_case_1 = require("../application/use-cases/plan/create-plan.use-case");
const list_plans_use_case_1 = require("../application/use-cases/plan/list-plans.use-case");
const delete_plan_use_case_1 = require("../application/use-cases/plan/delete-plan.use-case");
const user_repository_interface_1 = require("../core/repositories/user.repository.interface");
const prisma_user_repository_1 = require("../infrastructure/database/repositories/prisma-user.repository");
const plan_repository_interface_1 = require("../core/repositories/plan.repository.interface");
const prisma_plan_repository_1 = require("../infrastructure/database/repositories/prisma-plan.repository");
let PlanModule = class PlanModule {
};
exports.PlanModule = PlanModule;
exports.PlanModule = PlanModule = __decorate([
    (0, common_1.Module)({
        imports: [api_dom_module_1.ApiDomModule],
        controllers: [plan_controller_1.PlanController],
        providers: [
            create_plan_use_case_1.CreatePlanUseCase,
            list_plans_use_case_1.ListPlansUseCase,
            delete_plan_use_case_1.DeletePlanUseCase,
            { provide: user_repository_interface_1.USER_REPOSITORY, useClass: prisma_user_repository_1.PrismaUserRepository },
            { provide: plan_repository_interface_1.PLAN_REPOSITORY, useClass: prisma_plan_repository_1.PrismaPlanRepository },
        ],
    })
], PlanModule);
//# sourceMappingURL=plan.module.js.map