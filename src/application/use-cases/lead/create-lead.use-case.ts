import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { CreateLeadDto } from '../../dtos/lead/create-lead.dto';

@Injectable()
export class CreateLeadUseCase {
  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
  ) {}

  async execute(dto: CreateLeadDto) {
    return this.gateway.createLead(dto);
  }
}
