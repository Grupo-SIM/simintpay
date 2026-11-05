import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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

/** Dados do cartão enviados pelo checkout (mesmo formato do link de pagamento). */
export class OfferChargeCardDto {
  @ApiProperty() @IsString() token!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bin?: string;
  @ApiProperty() @IsString() exp_month!: string;
  @ApiProperty() @IsString() exp_year!: string;
  @ApiProperty() @IsString() cvv!: string;
  @ApiProperty() @IsString() holder_name!: string;
  @ApiProperty() @IsString() holder_document!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() number?: string;
}

/** Cobrança pública de uma oferta avulsa. */
export class OfferChargeDto {
  @ApiProperty({ enum: ['pix', 'credit_card', 'debit_card'] })
  @IsIn(['pix', 'credit_card', 'debit_card'])
  paymentMethod!: 'pix' | 'credit_card' | 'debit_card';

  @ApiProperty() @IsString() @MinLength(1) customerName!: string;
  @ApiProperty() @IsEmail() customerEmail!: string;
  @ApiProperty() @IsString() @MinLength(1) customerDocument!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'] })
  @IsOptional()
  @IsIn(['CPF', 'CNPJ'])
  documentType?: 'CPF' | 'CNPJ';

  @ApiPropertyOptional({ description: 'Somente cartão de crédito; padrão 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  installments?: number;

  @ApiPropertyOptional({ type: OfferChargeCardDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferChargeCardDto)
  card?: OfferChargeCardDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  tracking?: Record<string, string>;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Códigos dos order bumps escolhidos (veja `bumps` no GET público)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  bumpCodes?: string[];

  @ApiPropertyOptional({
    description:
      'Upsell/downsell: id da Charge PAGA do pedido principal, do mesmo comprador',
  })
  @IsOptional()
  @IsString()
  parentChargeId?: string;
}
