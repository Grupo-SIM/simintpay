import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutPixDto } from '../renovada/dtos/checkout-pix.dto';
import { CheckoutCreditCardDto } from '../renovada/dtos/checkout-credit-card.dto';

export class DeliveryAllocationItemDto {
  @IsString() @MinLength(1) key: string;
  @IsInt() @Min(1) quantity: number;
  @IsInt() @Min(0) unitPriceCents: number;
}

export class DeliveryAllocationDto {
  /** Order lines used to recompute the additive surcharge; absent keeps the legacy trusted `platformFeeCents`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DeliveryAllocationItemDto)
  items?: DeliveryAllocationItemDto[];

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
