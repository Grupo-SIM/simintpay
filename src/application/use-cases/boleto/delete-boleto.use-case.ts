import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { BOLETO_REPOSITORY } from '../../../core/repositories/boleto.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IBoletoRepository } from '../../../core/repositories/boleto.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeleteBoletoUseCase {
  private readonly logger = new Logger(DeleteBoletoUseCase.name);

  constructor(
    @Inject(BOLETO_REPOSITORY)
    private readonly boletos: IBoletoRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    // ADMIN (master) exclui qualquer boleto, independente de quem criou.
    const existing = input.role === 'ADMIN'
      ? await this.boletos.findById(input.id)
      : await this.boletos.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Boleto não encontrado');

    // Remoção na DOM é best-effort: falha não bloqueia a exclusão local.
    const domToken = process.env.DOM_TOKEN;
    if (domToken && existing.domPaymentLinkId) {
      try {
        await this.gateway.deletePaymentLink(domToken, existing.domPaymentLinkId);
      } catch (err: unknown) {
        this.logger.warn(
          `DOM deletePaymentLink (boleto) falhou para ${existing.domPaymentLinkId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    await this.boletos.delete(existing.id);
  }
}
