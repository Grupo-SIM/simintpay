import { GoneException, Injectable } from '@nestjs/common';

@Injectable()
export class ScanPlatformOwnersUseCase {
  async execute(): Promise<{ scanned: number; scannedDom: number; created: number; linked: number; walletsUpdated: number }> {
    throw new GoneException('Descoberta automática desativada. Cadastre a plataforma e atribua seu dono pelo admin.');
  }
}
