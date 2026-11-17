import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PixPlanCheckoutDto {
  @ApiProperty({ enum: ['MONTHLY', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] })
  @IsNotEmpty()
  @IsIn(['MONTHLY', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
  planType: 'MONTHLY' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

  @ApiProperty({ minimum: 5 })
  @IsNotEmpty()
  price: number;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  // Campo interno, não vem do body público
  pixCreditPlanId?: string;

  // Campo interno: repassado por checkout-by-code, não vem do body público
  tracking?: Record<string, string>;
}
