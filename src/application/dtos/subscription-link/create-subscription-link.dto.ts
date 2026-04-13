import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
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

export type FrequencyTypeDto = 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

export class CreateSubscriptionLinkDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  valor!: number;

  @IsEnum(['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  frequencia!: FrequencyTypeDto;

  /**
   * true = Avulso: cliente paga o valor exato (sem juros adicionais)
   * false = Plataforma: aplica platformFee% sobre o valor
   */
  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;

  /** Taxa de juros aplicada quando isStandalone=false. Default 9.00 */
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
   * E-mail da conta para a qual o link será criado.
   * Se informado (apenas admin), o sistema resolve o userId pelo e-mail → CPF da conta.
   */
  @IsEmail()
  @IsOptional()
  email?: string;

  /**
   * ID da comunidade a vincular automaticamente ao criar o link.
   * Opcional. Se não informado, cria sem comunidade (pode vincular manualmente depois).
   */
  @IsString()
  @IsOptional()
  communityId?: string;

  /**
   * Métodos de pagamento aceitos: 'PIX' | 'CREDIT_CARD' | 'BOTH'
   * Default: 'BOTH'
   */
  @IsEnum(['PIX', 'CREDIT_CARD', 'BOTH'])
  @IsOptional()
  paymentMethods?: 'PIX' | 'CREDIT_CARD' | 'BOTH';

  /**
   * Tag de plataforma para resolução de taxa (ex: AREAFLIX, COMUNIDADE, GLOBAL).
   * Sobrepõe a detecção automática por tenantModule ou webhookUrl.
   */
  @IsString()
  @IsOptional()
  platformTag?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  plataformas?: string[];
}
