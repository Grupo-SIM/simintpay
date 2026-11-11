import { PlatformIntegrationsController } from './controllers/platform-integrations.controller';
import { PlatformsController } from './controllers/platforms.controller';
import { PlatformsService } from '../application/services/platforms.service';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScanPlatformOwnersUseCase } from '../application/use-cases/admin/scan-platform-owners.use-case';
import { GetWalletCompositionUseCase } from '../application/use-cases/admin/get-wallet-composition.use-case';
import { LinkExternalPlatformUserService } from '../application/services/link-external-platform-user.service';
import { CpfLookupService } from '../infrastructure/http/cpf-lookup.service';
import { SyncDomTransactionsCron } from '../infrastructure/cron/sync-dom-transactions.cron';
import { SyncMaquinetasCron } from '../infrastructure/cron/sync-maquinetas.cron';
import { ExpirationReminderCron } from '../infrastructure/cron/expiration-reminder.cron';
import { CashbackGrantCron } from '../infrastructure/cron/cashback-grant.cron';
import { WalletConsistencyCron } from '../infrastructure/cron/wallet-consistency.cron';
import { AdminController } from './controllers/admin.controller';
import { AdminClientesController } from './controllers/admin-clientes.controller';
import { AdminAfiliadosController } from './controllers/admin-afiliados.controller';
import { ListLeadsUseCase } from '../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../application/use-cases/admin/reject-lead.use-case';
import { DeleteLeadsUseCase } from '../application/use-cases/admin/delete-leads.use-case';
import { SyncDomTransactionsUseCase } from '../application/use-cases/admin/sync-dom-transactions.use-case';
import { ListWithdrawalsAdminUseCase } from '../application/use-cases/admin/list-withdrawals-admin.use-case';
import { ApproveWithdrawalUseCase } from '../application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../application/use-cases/admin/reject-withdrawal.use-case';
import { MigrateRenovadaTxsToAdminUseCase } from '../application/use-cases/admin/migrate-renovada-txs-to-admin.use-case';
import { ListDomTransactionsDirectUseCase } from '../application/use-cases/admin/list-dom-transactions-direct.use-case';
import { SyncMaquinetasUseCase } from '../application/use-cases/admin/sync-maquinetas.use-case';
import { LEAD_REPOSITORY } from '../core/repositories/lead.repository.interface';
import { PrismaLeadRepository } from '../infrastructure/database/repositories/prisma-lead.repository';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';
import { WALLET_REPOSITORY } from '../core/repositories/wallet.repository.interface';
import { PrismaWalletRepository } from '../infrastructure/database/repositories/prisma-wallet.repository';
import { HASH_SERVICE } from '../core/services/hash.interface';
import { BcryptService } from '../infrastructure/security/bcrypt.service';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { EmailService } from '../infrastructure/email/email.service';
import { ModuleRealtimeModule } from '../infrastructure/realtime/module-realtime.module';
import { RevalidaModule } from '../modules/revalida/revalida.module';
import { PlatformTaxasService } from '../application/services/platform-taxas.service';
import { RolesGuard } from '../infrastructure/security/guards/roles.guard';
import { WebhookModule } from './webhook.module';
import { AuthModule } from './auth.module';
import { AuthTokensService } from '../application/use-cases/auth/auth-tokens.service';
import { ExternalPlatformDbModule } from '../modules/external-platform-db/external-platform-db.module';
import { AcquirerFeesController } from '../modules/financial-policy/acquirer-fees.controller';
import { AcquirerFeesService } from '../modules/financial-policy/acquirer-fees.service';
import { AcquirerWithdrawalsController } from '../modules/financial-policy/acquirer-withdrawals.controller';
import { AcquirerWithdrawalsService } from '../modules/financial-policy/acquirer-withdrawals.service';
import { SyncAcquirerFeesCron } from '../infrastructure/cron/sync-acquirer-fees.cron';
import { SyncAcquirerWithdrawalsCron } from '../infrastructure/cron/sync-acquirer-withdrawals.cron';

@Module({
  imports: [
    ApiDomModule,
    HttpModule,
    ModuleRealtimeModule,
    RevalidaModule,
    WebhookModule,
    ExternalPlatformDbModule,
    AuthModule,
  ],
  controllers: [
    PlatformIntegrationsController,
    PlatformsController,
    AcquirerFeesController,
    AcquirerWithdrawalsController,
    AdminController,
    AdminClientesController,
    AdminAfiliadosController,
  ],
  providers: [
    PlatformsService,
    AcquirerFeesService,
    AcquirerWithdrawalsService,
    SyncAcquirerFeesCron,
    SyncAcquirerWithdrawalsCron,
    SyncDomTransactionsCron,
    SyncMaquinetasCron,
    ExpirationReminderCron,
    WalletConsistencyCron,
    CashbackGrantCron,
    ListLeadsUseCase,
    ApproveLeadUseCase,
    RejectLeadUseCase,
    DeleteLeadsUseCase,
    SyncDomTransactionsUseCase,
    ListWithdrawalsAdminUseCase,
    ApproveWithdrawalUseCase,
    RejectWithdrawalUseCase,
    MigrateRenovadaTxsToAdminUseCase,
    ListDomTransactionsDirectUseCase,
    SyncMaquinetasUseCase,
    EmailService,
    PlatformTaxasService,
    AuthTokensService,
    RolesGuard,
    ScanPlatformOwnersUseCase,
    GetWalletCompositionUseCase,
    LinkExternalPlatformUserService,
    CpfLookupService,
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    { provide: HASH_SERVICE, useClass: BcryptService },
  ],
})
export class AdminModule {}
