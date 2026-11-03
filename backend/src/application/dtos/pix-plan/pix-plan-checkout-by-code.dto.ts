import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PixPlanCheckoutByCodeDto {
  @ApiProperty({ description: 'Code do PixPlanLinkCode' })
  @IsNotEmpty()
  code: string;

  @ApiProperty()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ enum: ['CPF', 'CNPJ'] })
  @IsNotEmpty()
  document_type: string;

  @ApiProperty()
  @IsNotEmpty()
  document: string;

  @ApiProperty()
  @IsNotEmpty()
  mobile_phone: string;

  @ApiPropertyOptional({ description: 'Código do voucher de desconto' })
  @IsOptional()
  @IsString()
  voucherCode?: string;

  @ApiPropertyOptional({ description: 'Valor final com desconto aplicado' })
  @IsOptional()
  @IsNumber()
  finalAmount?: number;

  @ApiPropertyOptional({ description: 'UTMs, src e fbc/fbp do checkout' })
  @IsOptional()
  @IsObject()
  tracking?: Record<string, string>;
}
