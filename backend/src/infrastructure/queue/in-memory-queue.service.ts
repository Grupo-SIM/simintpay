import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { IQueueService } from '../../core/services/queue.interface';

type Handler = (message: unknown) => Promise<void>;

/**
 * Fila em memória — substitui RabbitMQ para ambientes sem broker externo.
 * Garante processamento serial por fila (sem race conditions) via Promise chain.
 */
@Injectable()
export class InMemoryQueueService implements IQueueService, OnModuleDestroy {
  private readonly logger = new Logger(InMemoryQueueService.name);
  private readonly handlers = new Map<string, Handler>();
  private readonly chains = new Map<string, Promise<void>>();
  private destroyed = false;

  register(queue: string, handler: Handler): void {
    this.handlers.set(queue, handler);
    if (!this.chains.has(queue)) {
      this.chains.set(queue, Promise.resolve());
    }
    this.logger.log(`[InMemoryQueue] Handler registrado para fila "${queue}"`);
  }

  async publish(queue: string, message: unknown): Promise<void> {
    if (this.destroyed) return;

    const handler = this.handlers.get(queue);
    if (!handler) {
      this.logger.warn(`[InMemoryQueue] Nenhum handler para fila "${queue}" — mensagem descartada`);
      return;
    }

    // Serializa execução: cada mensagem espera a anterior terminar
    const prev = this.chains.get(queue) ?? Promise.resolve();
    const next = prev.then(() => {
      if (this.destroyed) return;
      return handler(message).catch((err: unknown) => {
        this.logger.error(
          `[InMemoryQueue] Erro ao processar mensagem da fila "${queue}": ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    });
    this.chains.set(queue, next);
  }

  onModuleDestroy(): void {
    this.destroyed = true;
  }
}
