import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { CheckoutPixDto } from '../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../renovada/dtos/checkout-credit-card.dto';

export class DeliveryAllocationDto {
  @IsInt()
  @Min(0)
  merchantAmountCents: number;

  @IsInt()
  @Min(0)
  platformFeeCents: number;
}

// Optional for other integrations; mandatory for sim-delivery_* at the service boundary.
export class IntegrationPixCheckoutDto extends CheckoutPixDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAllocationDto)
  allocation?: DeliveryAllocationDto;
}

export class IntegrationCardCheckoutDto extends CheckoutCreditCardDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAllocationDto)
  allocation?: DeliveryAllocationDto;
}
