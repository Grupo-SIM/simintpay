import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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
  aceitaDebito?: boolean;

  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;




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

  /** Corpo de e-mail personalizado enviado ao comprador (apenas itens de ebook) */
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  emailBody?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  plataformas?: string[];
}
