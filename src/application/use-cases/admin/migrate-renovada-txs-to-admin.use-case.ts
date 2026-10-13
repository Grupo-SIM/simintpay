import { GoneException, Injectable } from '@nestjs/common';

@Injectable()
export class MigrateRenovadaTxsToAdminUseCase {
  async execute(): Promise<never> {
    throw new GoneException('Migração automática de carteiras removida. Plataformas exigem atribuição explícita de dono.');
  }
}
