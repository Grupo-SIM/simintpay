import { ArrayMaxSize, IsArray, IsObject, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChargePixPaymentLinkDto {
  @IsOptional() @IsObject() tracking?: Record<string, string>;
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsEmail()
  @IsNotEmpty()
  customerEmail!: string;

  @IsString()
  @IsNotEmpty()
  customerDocument!: string;

  @IsString()
  @IsOptional()
  customerPhone?: string;

  @IsString()
  @IsOptional()
  documentType?: 'CPF' | 'CNPJ';

  /** Order bumps marcados no checkout */
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsOptional()
  orderBumpIds?: string[];

  /** Upsell/downsell pós-compra */
  @IsString()
  @IsOptional()
  offerId?: string;

  /** domPaymentId ou id da transação do pedido principal (obrigatório com offerId) */
  @IsString()
  @IsOptional()
  parentPaymentId?: string;
}
