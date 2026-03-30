import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

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
  @IsOptional()
  redirectUrl?: string;

  @IsString()
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
}
