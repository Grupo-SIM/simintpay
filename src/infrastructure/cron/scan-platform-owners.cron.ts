import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScanPlatformOwnersUseCase } from '../../application/use-cases/admin/scan-platform-owners.use-case';

@Injectable()
export class ScanPlatformOwnersCron {
  private readonly logger = new Logger(ScanPlatformOwnersCron.name);

  constructor(
    private readonly scanPlatformOwnersUseCase: ScanPlatformOwnersUseCase,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handle() {
    this.logger.log('Iniciando varredura de donos de plataformas...');
    try {
      const result = await this.scanPlatformOwnersUseCase.execute();
      this.logger.log(
        `Varredura concluída: ${JSON.stringify(result)}`,
      );
    } catch (err: any) {
      this.logger.error(`Erro na varredura de donos: ${err.message}`);
    }
  }
}
