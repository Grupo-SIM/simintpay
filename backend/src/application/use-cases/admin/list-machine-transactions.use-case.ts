import { Injectable, Inject } from '@nestjs/common';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';

@Injectable()
export class ListMachineTransactionsUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute() {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) {
      throw new Error('DOM_TOKEN não configurado no .env');
    }
    const result = await this.gateway.getSpecificMachineTransactions(domToken);
    const transactions = Array.isArray(result) ? result : (result?.transactions ?? result?.data ?? []);
    return { transactions };
  }
}
