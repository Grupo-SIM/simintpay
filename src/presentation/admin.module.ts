import { Module } from '@nestjs/common';
import { AdminController } from './controllers/admin.controller';
import { ListLeadsUseCase } from '../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../application/use-cases/admin/reject-lead.use-case';
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

@Module({
  imports: [ApiDomModule],
  controllers: [AdminController],
  providers: [
    ListLeadsUseCase,
    ApproveLeadUseCase,
    RejectLeadUseCase,
    EmailService,
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: WALLET_REPOSITORY, useClass: PrismaWalletRepository },
    { provide: HASH_SERVICE, useClass: BcryptService },
  ],
})
export class AdminModule {}
