import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncMaquinetasUseCase } from '../../application/use-cases/admin/sync-maquinetas.use-case';

/**
 * Sincroniza automaticamente transações de maquinetas a cada 10 minutos.
 * Busca apenas os últimos 2 dias para manter a execução leve.
 * Para desativar, defina DISABLE_MAQUINETA_SYNC=true no .env.
 */
@Injectable()
export class SyncMaquinetasCron {
  private readonly logger = new Logger(SyncMaquinetasCron.name);

  constructor(private readonly syncMaquinetas: SyncMaquinetasUseCase) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleSync() {
    if (process.env.DISABLE_MAQUINETA_SYNC === 'true') return;

    this.logger.log('🔄 [CRON-MAQUINETA] Sincronizando transações dos últimos 2 dias...');
    try {
      const result = await this.syncMaquinetas.execute(2);
      if (result.synced > 0 || result.errors > 0) {
        this.logger.log(`[CRON-MAQUINETA] ${result.message}`);
      } else {
        this.logger.debug(`[CRON-MAQUINETA] Nenhuma novidade (${result.skipped} já sincronizadas)`);
      }
    } catch (err: any) {
      this.logger.error(`[CRON-MAQUINETA] Erro: ${err.message}`);
    }
  }
}
