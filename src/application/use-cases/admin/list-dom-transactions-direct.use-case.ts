import { Injectable, Inject } from '@nestjs/common';
import dayjs from 'dayjs';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';

export interface ListDomTransactionsDirectInput {
  page?: number;
  limit?: number;
  status?: string;
  begin_date?: string;
  end_date?: string;
  payment_method?: string;
}

@Injectable()
export class ListDomTransactionsDirectUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(input: ListDomTransactionsDirectInput) {
    const domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
    if (!domToken) {
      throw new Error('DOM_TOKEN não configurado no .env');
    }

    // A API DOM exige datas obrigatoriamente — padrão: últimos 90 dias
    const end_date   = input.end_date   ?? dayjs().format('YYYY-MM-DD');
    const begin_date = input.begin_date ?? dayjs().subtract(90, 'day').format('YYYY-MM-DD');

    return this.gateway.listDomTransactions(domToken, {
      page: input.page ?? 1,
      limit: input.limit ?? 50,
      status: input.status,
      begin_date,
      end_date,
    });
  }
}
