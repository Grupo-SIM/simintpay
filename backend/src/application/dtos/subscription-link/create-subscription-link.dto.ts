import { IsObject } from 'class-validator';
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
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

function normalizeOptionalUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed))
    return `https://${trimmed}`;
  return trimmed;
}

export type FrequencyTypeDto = 'SEMANAL' | 'MENSAL' | 'ANUAL';

export class CreateSubscriptionLinkDto {
  /** Explicit beneficiary; platform selection must agree with its registered owner. */
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsObject()
  coproduction?: unknown;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  valor!: number;

  @IsEnum(['SEMANAL', 'MENSAL', 'ANUAL'])
  frequencia!: FrequencyTypeDto;

  /**
   * true = Avulso: cliente paga o valor exato (sem juros adicionais)
   * false = Plataforma: aplica platformFee% sobre o valor
   */
  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;

  /** Taxa de juros aplicada quando isStandalone=false. Default 9.00 */

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
   * Sobrepõe a detecção automática por platform ou webhookUrl.
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
