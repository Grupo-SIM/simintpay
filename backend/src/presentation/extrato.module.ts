import { Module } from '@nestjs/common';
import { ListExtratoUseCase } from '../application/use-cases/extrato/list-extrato.use-case';
import { ExtratoController } from './controllers/extrato.controller';
import { AuthModule } from './auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ExtratoController],
  providers: [ListExtratoUseCase],
})
export class ExtratoModule {}
