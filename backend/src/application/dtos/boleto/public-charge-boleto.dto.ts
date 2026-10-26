import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PublicChargeBoletoDto {
  @IsString()
  @IsNotEmpty()
  customerName!: string;

  @IsEmail()
  customerEmail!: string;

  @IsString()
  @IsNotEmpty()
  customerDocument!: string;

  @IsString()
  @IsOptional()
  customerPhone?: string;

  @IsIn(['CPF', 'CNPJ'])
  @IsOptional()
  documentType?: 'CPF' | 'CNPJ';

  // Endereço do pagador — OBRIGATÓRIO para boleto (a DOM recusa boleto sem endereço).
  // Opcional no DTO porque o mesmo DTO serve o endpoint de PIX (que não precisa).
  @IsString()
  @IsOptional()
  cep?: string;

  @IsString()
  @IsOptional()
  rua?: string;

  @IsString()
  @IsOptional()
  numero?: string;

  @IsString()
  @IsOptional()
  bairro?: string;

  @IsString()
  @IsOptional()
  cidade?: string;

  @IsString()
  @IsOptional()
  uf?: string;

  @IsString()
  @IsOptional()
  complemento?: string;
}
