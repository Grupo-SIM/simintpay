import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDecimal,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBillingContractDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Length(1, 50)
  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .toUpperCase(),
  )
  resourceType!: string;

  @IsString()
  @Length(1, 191)
  resourceId!: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  priceKey?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  pricingVersion?: number;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  baseAmount!: string;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  @Matches(/^\d+(?:\.\d{1,2})?$/)
  unitAmount!: string;

  @IsInt()
  @Min(0)
  quantity!: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  minimumQuantity?: number;

  @IsString()
  @Length(1, 191)
  externalSubscriptionId!: string;

  @IsDateString()
  currentPeriodStart!: string;

  @IsDateString()
  currentPeriodEnd!: string;

  @IsString()
  @MaxLength(255)
  @IsOptional()
  description?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
