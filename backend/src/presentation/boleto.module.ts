import { Module } from '@nestjs/common';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';
import { PrismaService } from '../infrastructure/database/prisma/prisma.service';
import { BoletoController } from './controllers/boleto.controller';
import { CreateBoletoUseCase } from '../application/use-cases/boleto/create-boleto.use-case';
import { ListBoletosUseCase } from '../application/use-cases/boleto/list-boletos.use-case';
import { GetBoletoUseCase } from '../application/use-cases/boleto/get-boleto.use-case';
import { UpdateBoletoUseCase } from '../application/use-cases/boleto/update-boleto.use-case';
import { DeleteBoletoUseCase } from '../application/use-cases/boleto/delete-boleto.use-case';
import { GetPublicBoletoUseCase } from '../application/use-cases/boleto/get-public-boleto.use-case';
import { ChargeBoletoUseCase } from '../application/use-cases/boleto/charge-boleto.use-case';
import { ChargeBoletoPixUseCase } from '../application/use-cases/boleto/charge-boleto-pix.use-case';
import { BOLETO_REPOSITORY } from '../core/repositories/boleto.repository.interface';
import { PrismaBoletoRepository } from '../infrastructure/database/repositories/prisma-boleto.repository';
import { USER_REPOSITORY } from '../core/repositories/user.repository.interface';
import { PrismaUserRepository } from '../infrastructure/database/repositories/prisma-user.repository';

@Module({
  imports: [ApiDomModule],
  controllers: [BoletoController],
  providers: [
    PrismaService,
    CreateBoletoUseCase,
    ListBoletosUseCase,
    GetBoletoUseCase,
    UpdateBoletoUseCase,
    DeleteBoletoUseCase,
    GetPublicBoletoUseCase,
    ChargeBoletoUseCase,
    ChargeBoletoPixUseCase,
    { provide: BOLETO_REPOSITORY, useClass: PrismaBoletoRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class BoletoModule {}
