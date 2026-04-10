import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateClienteDto {
  @ApiProperty({ description: 'Nome completo do cliente' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Email do cliente' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ description: 'Documento do cliente (CPF/CNPJ)' })
  @IsString()
  @IsOptional()
  document?: string;

  @ApiProperty({ description: 'Tipo de documento', enum: ['CPF', 'CNPJ'], default: 'CPF' })
  @IsString()
  @IsOptional()
  documentType?: string;

  @ApiProperty({ description: 'Telefone celular do cliente', required: false })
  @IsString()
  @IsOptional()
  phone?: string;
}
