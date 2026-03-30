import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsString()
  @IsNotEmpty()
  titulo!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  valor!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  parcelasMax?: number;

  @IsBoolean()
  @IsOptional()
  aceitaCartao?: boolean;

  @IsBoolean()
  @IsOptional()
  aceitaPix?: boolean;

  /** true = Avulso (1x sem juros, 2x+ com juros); false = Plataforma (sempre com juros) */
  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;

  @IsNumber()
  @IsOptional()
  platformFee1x?: number;

  @IsNumber()
  @IsOptional()
  platformFee2x?: number;

  @IsNumber()
  @IsOptional()
  platformFee3x?: number;

  @IsNumber()
  @IsOptional()
  platformFee4x?: number;

  @IsNumber()
  @IsOptional()
  platformFee5x?: number;

  @IsNumber()
  @IsOptional()
  platformFee6x?: number;

  @IsNumber()
  @IsOptional()
  platformFee7x?: number;

  @IsNumber()
  @IsOptional()
  platformFee8x?: number;

  @IsNumber()
  @IsOptional()
  platformFee9x?: number;

  @IsNumber()
  @IsOptional()
  platformFee10x?: number;

  @IsNumber()
  @IsOptional()
  platformFee11x?: number;

  @IsNumber()
  @IsOptional()
  platformFee12x?: number;

  @IsNumber()
  @IsOptional()
  cashbackFee?: number;

  @IsString()
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @IsOptional()
  webhookUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsDateString()
  @IsOptional()
  dataExpiracao?: string;

  /** Email do usuário para criar o link em nome de outro usuário (apenas admin) */
  @IsString()
  @IsOptional()
  email?: string;
}
