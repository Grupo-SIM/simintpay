import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SyncDomTransactionsCron } from '../infrastructure/cron/sync-dom-transactions.cron';
import { SyncMaquinetasCron } from '../infrastructure/cron/sync-maquinetas.cron';
import { CommunityAccessCron } from '../infrastructure/cron/community-access.cron';
import { AdminController } from './controllers/admin.controller';
import { ListLeadsUseCase } from '../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../application/use-cases/admin/reject-lead.use-case';
import { SyncDomTransactionsUseCase } from '../application/use-cases/admin/sync-dom-transactions.use-case';
import { ListWithdrawalsAdminUseCase } from '../application/use-cases/admin/list-withdrawals-admin.use-case';
import { ApproveWithdrawalUseCase } from '../application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../application/use-cases/admin/reject-withdrawal.use-case';
import { SyncDomWithdrawalsUseCase } from '../application/use-cases/admin/sync-dom-withdrawals.use-case';
import { SyncFullRenovadaUseCase } from '../application/use-cases/admin/sync-full-renovada.use-case';
import { SyncFullBosqueUseCase } from '../application/use-cases/admin/sync-full-bosque.use-case';
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
import { CommunityManagementService } from '../application/services/community-management.service';

@Module({
  imports: [ApiDomModule, HttpModule, ModuleRealtimeModule, RevalidaModule],
  controllers: [AdminController],
  providers: [
    SyncDomTransactionsCron,
    SyncMaquinetasCron,
    CommunityAccessCron,
    ListLeadsUseCase,
    ApproveLeadUseCase,
    RejectLeadUseCase,
    SyncDomTransactionsUseCase,
    ListWithdrawalsAdminUseCase,
    ApproveWithdrawalUseCase,
    RejectWithdrawalUseCase,
    SyncDomWithdrawalsUseCase,
    SyncFullRenovadaUseCase,
    SyncFullBosqueUseCase,
    MigrateRenovadaTxsToAdminUseCase,
    ListDomTransactionsDirectUseCase,
    SyncMaquinetasUseCase,
    EmailService,
    CommunityManagementService,
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    { provide: HASH_SERVICE, useClass: BcryptService },
  ],
})
export class AdminModule {}
