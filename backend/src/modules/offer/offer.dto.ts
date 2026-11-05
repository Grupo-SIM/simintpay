import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const KINDS = [
  'PAYMENT_LINK',
  'SUBSCRIPTION_LINK',
  'PLAN',
  'PIX_PLAN',
  'BOLETO',
] as const;
const METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'] as const;
const RENEWALS = ['NONE', 'AUTO_CHARGE', 'MANUAL_PAY'] as const;
const INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

/** Campos editáveis de uma oferta. Titular, código e plataforma nunca mudam na edição. */
export class UpdateOfferDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Valor em centavos' })
  @IsOptional()
  @IsInt()
  amountCents?: number;

  @ApiPropertyOptional({ enum: METHODS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(METHODS, { each: true })
  acceptedMethods?: (typeof METHODS)[number][];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  maxInstallments?: number;

  @ApiPropertyOptional({ enum: RENEWALS })
  @IsOptional()
  @IsIn(RENEWALS)
  renewalMode?: (typeof RENEWALS)[number];

  @ApiPropertyOptional({ enum: INTERVALS })
  @IsOptional()
  @IsIn(INTERVALS)
  intervalType?: (typeof INTERVALS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  intervalCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  repetitions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  trialDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  retryDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  graceDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  accessDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  fulfillment?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateOfferDto extends OmitType(UpdateOfferDto, [
  'name',
  'amountCents',
] as const) {
  @ApiProperty({ enum: KINDS })
  @IsIn(KINDS)
  kind!: (typeof KINDS)[number];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Valor em centavos' })
  @IsInt()
  amountCents!: number;

  /** Titular explícito; deve coincidir com o dono da plataforma quando houver. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  /** Plataforma cadastrada (uma única por operação). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  platformTag?: string;
}

export class ListOffersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @ApiPropertyOptional({ enum: KINDS })
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];
}
