import { Logger } from '@nestjs/common';

export const BUYER_NOTIFIER = Symbol('BUYER_NOTIFIER');

export type ChargeDueNotice = {
  contractId: string;
  chargeId: string;
  amountCents: number;
  customerEmail: string | null;
};

/** Avisa o comprador de que há uma cobrança a pagar. Implementação real (e-mail/WhatsApp) virá depois. */
export interface BuyerNotifier {
  chargeDue(notice: ChargeDueNotice): Promise<void>;
}

/** Implementação padrão: apenas registra em log, sem enviar nada. */
export class LoggingBuyerNotifier implements BuyerNotifier {
  private readonly logger = new Logger(LoggingBuyerNotifier.name);

  async chargeDue(notice: ChargeDueNotice): Promise<void> {
    this.logger.log(
      `CHARGE_DUE contrato=${notice.contractId} cobrança=${notice.chargeId} valor=${notice.amountCents}`,
    );
  }
}
