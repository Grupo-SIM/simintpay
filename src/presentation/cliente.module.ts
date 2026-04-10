import { Module } from '@nestjs/common';
import { ClienteController } from './controllers/cliente.controller';
import { DeleteClienteUseCase } from '../application/use-cases/cliente/delete-cliente.use-case';
import { ListClientesUseCase } from '../application/use-cases/cliente/list-clientes.use-case';
import { GetClienteUseCase } from '../application/use-cases/cliente/get-cliente.use-case';
import { CreateClienteUseCase } from '../application/use-cases/cliente/create-cliente.use-case';
import { GetClientePlanAccessUseCase } from '../application/use-cases/cliente/get-cliente-plan-access.use-case';
import { ApiDomModule } from '../infrastructure/http/api-dom.module';

@Module({
  imports: [ApiDomModule],
  controllers: [ClienteController],
  providers: [
    DeleteClienteUseCase,
    ListClientesUseCase,
    GetClienteUseCase,
    CreateClienteUseCase,
    GetClientePlanAccessUseCase,
  ],
  exports: [
    DeleteClienteUseCase,
    ListClientesUseCase,
    GetClienteUseCase,
    CreateClienteUseCase,
    GetClientePlanAccessUseCase,
  ],
})
export class ClienteModule {}
