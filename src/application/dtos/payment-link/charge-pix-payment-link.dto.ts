import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ChargePixPaymentLinkDto {
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
}
