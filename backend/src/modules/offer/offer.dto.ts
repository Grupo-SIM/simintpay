import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const METHODS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'] as const;
const RENEWALS = ['NONE', 'AUTO_CHARGE', 'MANUAL_PAY'] as const;
const INTERVALS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

/** Extras de um bump enviados à prévia de preço, ecoados em `bumps[]`. */
export class OfferPreviewBumpDto {
  @ApiProperty()
  @IsString()
  offerId!: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  originalAmountCents?: number | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  countdownSeconds?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Campos editáveis de uma oferta. O código nunca muda; titular e plataforma só são reatribuídos por admin. */
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

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  trialDays?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  retryDays?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  graceDays?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number | null;

  @ApiPropertyOptional({
    description:
      'Entrega pós-pagamento. `bumps` é a lista completa (envie sempre inteira): cada item tem offerId, role (BUMP|UPSELL|DOWNSELL) e opcionais headline (<=120), originalAmountCents (> preço da oferta), countdownSeconds (30..3600, só UPSELL/DOWNSELL) e isActive. Limites: 5 BUMP, 1 UPSELL, 1 DOWNSELL; downsell exige upsell.',
  })
  @IsOptional()
  @IsObject()
  fulfillment?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Reativa ou desativa a oferta' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Admin: novo titular financeiro (deve ser o dono da plataforma, quando houver uma). Demais contas só podem informar o próprio titular',
  })
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Nova plataforma (do próprio titular, ou qualquer uma para admin); null remove a plataforma (venda pessoal do titular)',
  })
  @IsOptional()
  @IsString()
  platformTag?: string | null;
}

export class CreateOfferDto extends OmitType(UpdateOfferDto, [
  'name',
  'amountCents',
  'isActive',
  'ownerUserId',
  'platformTag',
] as const) {
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

export const OFFER_LIST_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'EXHAUSTED',
  'EXPIRED',
] as const;
export const OFFER_LIST_SORTS = [
  'newest',
  'oldest',
  'name',
  'amountAsc',
  'amountDesc',
] as const;
export const OFFER_LIST_MAX_PAGE_SIZE = 100;
export const OFFER_LIST_DEFAULT_PAGE_SIZE = 20;

export class ListOffersQueryDto {
  @ApiPropertyOptional({
    description: 'Busca administrativa por nome ou e-mail do dono',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  ownerSearch?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @ApiPropertyOptional({ description: 'Busca por nome ou código' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({
    enum: OFFER_LIST_STATUSES,
    description:
      'ACTIVE: vendável; INACTIVE: desativada; EXPIRED: ativa porém vencida; EXHAUSTED: ativa e com limite de usos atingido',
  })
  @IsOptional()
  @IsIn(OFFER_LIST_STATUSES)
  status?: (typeof OFFER_LIST_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Tag da plataforma' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  platformTag?: string;

  @ApiPropertyOptional({ enum: METHODS, description: 'Meio aceito' })
  @IsOptional()
  @IsIn(METHODS)
  paymentMethod?: (typeof METHODS)[number];

  @ApiPropertyOptional({ enum: RENEWALS, description: 'Recorrência' })
  @IsOptional()
  @IsIn(RENEWALS)
  renewalMode?: (typeof RENEWALS)[number];

  @ApiPropertyOptional({ enum: OFFER_LIST_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(OFFER_LIST_SORTS)
  sort?: (typeof OFFER_LIST_SORTS)[number];

  @ApiPropertyOptional({
    description:
      'Quando `page` ou `pageSize` é informado a resposta vira { data, meta }; sem eles continua sendo a lista completa',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: OFFER_LIST_DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OFFER_LIST_MAX_PAGE_SIZE)
  pageSize?: number;
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
  @ApiProperty({ enum: ['pix', 'credit_card', 'debit_card', 'boleto'] })
  @IsIn(['pix', 'credit_card', 'debit_card', 'boleto'])
  paymentMethod!: 'pix' | 'credit_card' | 'debit_card' | 'boleto';

  @ApiProperty() @IsString() @MinLength(1) customerName!: string;
  @ApiProperty() @IsEmail() customerEmail!: string;
  @ApiProperty() @IsString() @MinLength(1) customerDocument!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'] })
  @IsOptional()
  @IsIn(['CPF', 'CNPJ'])
  documentType?: 'CPF' | 'CNPJ';

  @ApiPropertyOptional({
    description:
      'Endereço do pagador, obrigatório para boleto (mesmos campos do boleto legado): CEP',
  })
  @IsOptional()
  @IsString()
  cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rua?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cidade?: string;
  @ApiPropertyOptional({ description: 'UF com 2 letras' })
  @IsOptional()
  @IsString()
  uf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complemento?: string;

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
  @IsString({ each: true })
  bumpCodes?: string[];

  @ApiPropertyOptional({
    description:
      'Cupom do vendedor: o desconto incide sobre o valor da venda, antes das taxas. O uso só é contado quando o pagamento é aprovado',
  })
  @IsOptional()
  @IsString()
  voucherCode?: string;

  @ApiPropertyOptional({
    description:
      'Upsell/downsell: id da Charge PAGA do pedido principal, do mesmo comprador',
  })
  @IsOptional()
  @IsString()
  parentChargeId?: string;
}

/** Read-only quote of an unsaved offer; ownership is resolved exactly as on creation. */
export class OfferPreviewPricingDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(100000000000)
  amountCents!: number;
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(12)
  maxInstallments!: number;
  @ApiProperty({ enum: METHODS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(METHODS, { each: true })
  acceptedMethods!: (typeof METHODS)[number][];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  platformTag?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerUserId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  offerId?: string;
  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  bumpOfferIds?: string[];
  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  selectedBumpOfferIds?: string[];
  @ApiPropertyOptional({
    type: () => [OfferPreviewBumpDto],
    description:
      'Extras (chamada, valor "de", cronômetro, ativo) ecoados em `bumps[]`; itens inativos são omitidos',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OfferPreviewBumpDto)
  bumps?: OfferPreviewBumpDto[];
}

/** Validação pública de cupom no checkout de uma oferta. */
export class OfferValidateVoucherDto {
  @ApiProperty({ description: 'Código do cupom' })
  @IsString()
  @MinLength(1)
  voucherCode!: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Order bumps escolhidos: entram no valor sobre o qual o cupom incide',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bumpCodes?: string[];
}
