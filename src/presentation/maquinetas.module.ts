import { Module } from '@nestjs/common';
import { AuthModule } from './auth.module';
import { MaquinetasController } from './controllers/maquinetas.controller';

@Module({
  imports: [AuthModule],
  controllers: [MaquinetasController],
})
export class MaquinetasModule {}
