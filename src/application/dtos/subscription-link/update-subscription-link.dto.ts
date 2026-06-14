import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

function normalizeOptionalUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export class UpdateSubscriptionLinkDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nome?: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;

  @IsNumber()
  @IsOptional()
  valor?: number;

  @IsString()
  @IsOptional()
  frequencia?: string;

  @IsString()
  @IsOptional()
  paymentMethods?: string;

  @IsNumber()
  @IsOptional()
  platformFee?: number;

  @IsString()
  @Transform(({ value }) => normalizeOptionalUrl(value))
  @IsUrl({ require_protocol: true })
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @Transform(({ value }) => normalizeOptionalUrl(value))
  @IsUrl({ require_protocol: true })
  @IsOptional()
  webhookUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  /**
   * Tag de plataforma para resolução de taxa (ex: AREAFLIX, COMUNIDADE, GLOBAL).
   * Sobrepõe a detecção automática por tenantModule ou webhookUrl.
   */
  @IsString()
  @IsOptional()
  platformTag?: string;

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
