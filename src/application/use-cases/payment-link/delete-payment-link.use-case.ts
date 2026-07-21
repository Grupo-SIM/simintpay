import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PAYMENT_LINK_REPOSITORY } from '../../../core/repositories/payment-link.repository.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentLinkRepository } from '../../../core/repositories/payment-link.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class DeletePaymentLinkUseCase {
  private readonly logger = new Logger(DeletePaymentLinkUseCase.name);

  constructor(
    @Inject(PAYMENT_LINK_REPOSITORY)
    private readonly links: IPaymentLinkRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: { userId: string; role?: string; id: string }): Promise<void> {
    // ADMIN (master) exclui qualquer link, independente de quem criou.
    const existing = input.role === 'ADMIN'
      ? await this.links.findById(input.id)
      : await this.links.findByIdForUser({ id: input.id, userId: input.userId });
    if (!existing) throw new NotFoundException('Link não encontrado');

    // Remoção na DOM é best-effort: se o link já não existe lá (ou o DOM falha),
    // NÃO pode bloquear a exclusão local — senão o master fica sem conseguir
    // apagar o link. Alinhado ao update, que já ignora falha do DOM.
    const domToken = process.env.DOM_TOKEN;
    if (domToken && existing.domPaymentLinkId) {
      try {
        await this.gateway.deletePaymentLink(domToken, existing.domPaymentLinkId);
      } catch (err: unknown) {
        this.logger.warn(
          `DOM deletePaymentLink falhou para ${existing.domPaymentLinkId}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    await this.links.delete(existing.id);
  }
}
