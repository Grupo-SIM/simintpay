import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { CheckoutPixDto } from '../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../renovada/dtos/checkout-credit-card.dto';

export const DELIVERY_FEE_MODES = [
  'SIMINTPAY_ONLY',
  'ADDITIVE_ONLY',
  'BOTH',
] as const;
export type DeliveryFeeMode = (typeof DELIVERY_FEE_MODES)[number];

export class DeliveryAllocationDto {
  /** Frozen by Delivery when the order was priced; omitted means ADDITIVE_ONLY. */
  @IsOptional() @IsIn(DELIVERY_FEE_MODES) feeMode?: DeliveryFeeMode;
  @IsOptional() @IsInt() @Min(0) itemsAmountCents?: number;
  @IsOptional() @IsInt() @Min(0) deliveryAmountCents?: number;
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
