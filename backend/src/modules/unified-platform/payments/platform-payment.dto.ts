import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryAllocationItemDto } from '../../integrations/integration-checkout.dto';

export class PlatformPaymentCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(11) @MaxLength(20) document!: string;
  @IsIn(['CPF', 'CNPJ']) documentType!: 'CPF' | 'CNPJ';
  @IsOptional() @IsString() phone?: string;
}

export class PlatformPaymentCardDto {
  @IsString() @MinLength(1) @MaxLength(4096) token!: string;
  @IsString() @MinLength(2) @MaxLength(200) holderName!: string;
  @IsString() @MinLength(6) @MaxLength(8) bin!: string;
  @IsString() @MinLength(1) @MaxLength(40) brand!: string;
  @IsInt() @Min(1) @Max(12) installments!: number;
}

export class PlatformPaymentAllocationDto {
  /** Order lines used to recompute the additive surcharge; absent keeps the legacy trusted `platformFeeCents`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DeliveryAllocationItemDto)
  items?: DeliveryAllocationItemDto[];
  @IsOptional() @IsInt() @Min(0) itemsAmountCents?: number;
  @IsOptional() @IsInt() @Min(0) deliveryAmountCents?: number;
  @IsInt() @Min(0) merchantAmountCents!: number;
  @IsInt() @Min(0) platformFeeCents!: number;
}
/**
 * Pricing inputs shared by the quote and the charge. `amountCents` is the seller base (items after discounts plus
 * delivery); SimIntPay adds passed interest and additive fees on top. `items` enable product-scope additive fees;
 * `itemsAmountCents` + `deliveryAmountCents` (both or neither) must add up to `amountCents`.
 */
export class PlatformPaymentPricingDto {
  @IsInt() @Min(1) @Max(999999999999) amountCents!: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => DeliveryAllocationItemDto)
  items?: DeliveryAllocationItemDto[];
  @IsOptional() @IsInt() @Min(0) itemsAmountCents?: number;
  @IsOptional() @IsInt() @Min(0) deliveryAmountCents?: number;
}

export class QuotePlatformPaymentDto extends PlatformPaymentPricingDto {
  @IsIn(['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'])
  paymentMethod!: 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'BOLETO';
  @IsOptional() @IsInt() @Min(1) @Max(12) installments?: number;
}

export class CreatePlatformPaymentDto extends PlatformPaymentPricingDto {
  /** @deprecated Delivery's legacy pre-priced split; send the pricing fields and `expectedTotalCents` instead. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PlatformPaymentAllocationDto)
  allocation?: PlatformPaymentAllocationDto;
  @IsOptional() @IsString() @MaxLength(128) linkId?: string;
  /** Buyer total shown from the quote; a different current quote fails with 409 `QUOTE_CHANGED`. */
  @IsOptional() @IsInt() @Min(1) expectedTotalCents?: number;
  /** Informational; card charges use `card.installments`. */
  @IsOptional() @IsInt() @Min(1) @Max(12) installments?: number;
  @IsIn(['PIX', 'CREDIT_CARD']) paymentMethod!: 'PIX' | 'CREDIT_CARD';
  @IsString() @MinLength(1) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** CPF/CNPJ (digits) the sale is issued under; stored on the transaction for the merchant's records. */
  @IsOptional() @Matches(/^(\d{11}|\d{14})$/) merchantDocument?: string;
  /** Attribution (utm_*, src, aff...); `aff` names an affiliate of the platform, never a financial input. */
  @IsOptional() @IsObject() tracking?: Record<string, unknown>;
  @IsDefined()
  @ValidateNested()
  @Type(() => PlatformPaymentCustomerDto)
  customer!: PlatformPaymentCustomerDto;
  @ValidateIf((value) => value.paymentMethod === 'CREDIT_CARD')
  @IsDefined()
  @ValidateNested()
  @Type(() => PlatformPaymentCardDto)
  card?: PlatformPaymentCardDto;
}
