import { IsObject } from 'class-validator';
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
  Min,
  MaxLength,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsOptional()
  @IsObject()
  coproduction?: unknown;

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
  aceitaDebito?: boolean;

  @IsBoolean()
  @IsOptional()
  aceitaPix?: boolean;

  /** true = Avulso (1x sem juros, 2x+ com juros); false = Plataforma (sempre com juros) */
  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;




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
