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

export class UpdatePaymentLinkDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  titulo?: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  @IsOptional()
  valor?: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  parcelasMax?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

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
  webhookUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsDateString()
  @IsOptional()
  dataExpiracao?: string;
}
