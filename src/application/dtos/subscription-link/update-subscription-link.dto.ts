import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
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
}
